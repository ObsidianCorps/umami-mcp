import { describe, expect, it, vi } from 'vitest';

import { UmamiApiError, UmamiClient, UmamiResponseTooLargeError } from '../src/umami/client.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { ...init, headers });
}

describe('UmamiClient', () => {
  it('authenticates requests and serializes supported query values', async () => {
    let received: Request | undefined;
    const client = new UmamiClient({
      baseUrl: 'https://api.umami.is/v1',
      authentication: { type: 'api-key', value: 'cloud-key' },
      timeoutMs: 1000,
      maxResponseBytes: 10_000,
      fetch: (request) => {
        received = new Request(request);
        return Promise.resolve(jsonResponse({ ok: true }));
      },
    });

    const result = await client.request('/websites', {
      query: {
        active: false,
        empty: undefined,
        page: 2,
        path: ['/docs', '/pricing'],
        search: 'obsidian & analytics',
      },
    });

    expect(result).toEqual({ ok: true });
    expect(received?.headers.get('authorization')).toBe('Bearer cloud-key');
    expect(received?.headers.get('accept')).toBe('application/json');
    expect(received?.url).toBe(
      'https://api.umami.is/v1/websites?active=false&page=2&path=%2Fdocs&path=%2Fpricing&search=obsidian+%26+analytics',
    );
  });

  it('logs in lazily and refreshes an expired self-hosted token once', async () => {
    const received: Request[] = [];
    let loginCount = 0;
    let websiteCount = 0;
    let unauthorizedBodyCancelled = false;
    const client = new UmamiClient({
      baseUrl: 'https://analytics.example.com/api',
      authentication: { type: 'password', username: 'operator', password: 'secret' },
      timeoutMs: 1000,
      maxResponseBytes: 10_000,
      fetch: (request) => {
        const copy = new Request(request);
        received.push(copy);
        if (copy.url.endsWith('/auth/login')) {
          loginCount += 1;
          return Promise.resolve(jsonResponse({ token: `token-${loginCount}` }));
        }
        websiteCount += 1;
        return Promise.resolve(
          websiteCount === 1
            ? new Response(
                new ReadableStream({
                  start(controller) {
                    controller.enqueue(new TextEncoder().encode('{"message":"Unauthorized"}'));
                  },
                  cancel() {
                    unauthorizedBodyCancelled = true;
                  },
                }),
                { status: 401, headers: { 'content-type': 'application/json' } },
              )
            : jsonResponse([{ id: 'website-id' }]),
        );
      },
    });

    await expect(client.request('/websites')).resolves.toEqual([{ id: 'website-id' }]);
    expect(received.map((request) => request.headers.get('authorization'))).toEqual([
      null,
      'Bearer token-1',
      null,
      'Bearer token-2',
    ]);
    await expect(received[0]?.json()).resolves.toEqual({
      username: 'operator',
      password: 'secret',
    });
    expect(unauthorizedBodyCancelled).toBe(true);
  });

  it('completes Umami two-factor authentication before sending the API request', async () => {
    const received: Request[] = [];
    const client = new UmamiClient({
      baseUrl: 'https://analytics.example.com/api',
      authentication: {
        type: 'password',
        username: 'operator',
        password: 'secret',
        twoFactorCode: '123456',
      },
      timeoutMs: 1000,
      maxResponseBytes: 10_000,
      fetch: (request) => {
        const copy = new Request(request);
        received.push(copy);
        if (copy.url.endsWith('/auth/login')) {
          return Promise.resolve(
            jsonResponse({ requiresTwoFactor: true, partialToken: 'partial-token' }),
          );
        }
        if (copy.url.endsWith('/2fa/verify')) {
          return Promise.resolve(
            jsonResponse({
              token: 'full-token',
              user: {
                id: 'user-id',
                username: 'operator',
                role: 'view-only',
                createdAt: '2026-09-03T00:00:00.000Z',
                isAdmin: false,
                teams: [],
              },
            }),
          );
        }
        return Promise.resolve(jsonResponse([{ id: 'website-id' }]));
      },
    });

    await expect(client.request('/websites')).resolves.toEqual([{ id: 'website-id' }]);
    expect(received.map((request) => new URL(request.url).pathname)).toEqual([
      '/api/auth/login',
      '/api/2fa/verify',
      '/api/websites',
    ]);
    expect(received[1]?.headers.get('authorization')).toBe('Bearer partial-token');
    await expect(received[1]?.json()).resolves.toEqual({ token: '123456' });
    expect(received[2]?.headers.get('authorization')).toBe('Bearer full-token');
  });

  it('generates the current Umami TOTP from a Base32 secret', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(59_000));
    const received: Request[] = [];
    const client = new UmamiClient({
      baseUrl: 'https://analytics.example.com/api',
      authentication: {
        type: 'password',
        username: 'operator',
        password: 'secret',
        twoFactorSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      },
      timeoutMs: 1000,
      maxResponseBytes: 10_000,
      fetch: (request) => {
        const copy = new Request(request);
        received.push(copy);
        if (copy.url.endsWith('/auth/login')) {
          return Promise.resolve(
            jsonResponse({ requiresTwoFactor: true, partialToken: 'partial-token' }),
          );
        }
        if (copy.url.endsWith('/2fa/verify')) {
          return Promise.resolve(jsonResponse({ token: 'full-token', user: {} }));
        }
        return Promise.resolve(jsonResponse([]));
      },
    });

    try {
      await expect(client.request('/websites')).resolves.toEqual([]);
      await expect(received[1]?.json()).resolves.toEqual({ token: '287082' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('explains how to continue when the account requires two-factor authentication', async () => {
    let requestCount = 0;
    const client = new UmamiClient({
      baseUrl: 'https://analytics.example.com/api',
      authentication: { type: 'password', username: 'operator', password: 'secret' },
      timeoutMs: 1000,
      maxResponseBytes: 10_000,
      fetch: () => {
        requestCount += 1;
        return Promise.resolve(
          requestCount === 1
            ? jsonResponse({ requiresTwoFactor: true, partialToken: 'partial-token' })
            : jsonResponse({ error: { code: 'two-factor-invalid-token' } }, { status: 401 }),
        );
      },
    });

    await expect(client.request('/websites')).rejects.toThrowError(
      'Umami requires two-factor authentication; configure UMAMI_TWO_FACTOR_SECRET',
    );
    expect(requestCount).toBe(1);
  });

  it('sends JSON bodies and handles empty success responses', async () => {
    let received: Request | undefined;
    const client = new UmamiClient({
      baseUrl: 'https://analytics.example.com/api',
      authentication: { type: 'token', value: 'jwt' },
      timeoutMs: 1000,
      maxResponseBytes: 10_000,
      fetch: (request) => {
        received = new Request(request);
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    });

    await expect(
      client.request('/reports/funnel', { method: 'POST', body: { websiteId: 'site-id' } }),
    ).resolves.toBeNull();
    expect(received?.method).toBe('POST');
    expect(received?.headers.get('content-type')).toBe('application/json');
    await expect(received?.json()).resolves.toEqual({ websiteId: 'site-id' });
  });

  it('returns actionable errors without leaking authorization', async () => {
    const client = new UmamiClient({
      baseUrl: 'https://analytics.example.com/api',
      authentication: { type: 'token', value: 'highly-secret-jwt' },
      timeoutMs: 1000,
      maxResponseBytes: 10_000,
      fetch: () =>
        Promise.resolve(
          jsonResponse(
            { error: 'Forbidden', message: 'Website is not accessible' },
            { status: 403, headers: { 'x-request-id': 'request-123' } },
          ),
        ),
    });

    const error = await client.request('/websites/private').catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(UmamiApiError);
    expect(error).toMatchObject({
      status: 403,
      method: 'GET',
      path: '/websites/private',
      requestId: 'request-123',
    });
    expect(String(error)).toContain('Website is not accessible');
    expect(String(error)).not.toContain('highly-secret-jwt');
  });

  it('refuses responses larger than its configured byte budget', async () => {
    const client = new UmamiClient({
      baseUrl: 'https://analytics.example.com/api',
      authentication: { type: 'token', value: 'jwt' },
      timeoutMs: 1000,
      maxResponseBytes: 8,
      fetch: () =>
        Promise.resolve(new Response('0123456789', { headers: { 'content-type': 'text/plain' } })),
    });

    await expect(client.request('/export')).rejects.toBeInstanceOf(UmamiResponseTooLargeError);
  });
});
