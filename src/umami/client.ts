import type { Authentication } from '../config.js';
import { generateTotp } from './totp.js';

export class UmamiApiError extends Error {
  override readonly name = 'UmamiApiError';
  readonly details: unknown;
  readonly method: string;
  readonly path: string;
  readonly requestId: string | undefined;
  readonly status: number;

  constructor(options: {
    details: unknown;
    message: string;
    method: string;
    path: string;
    requestId: string | undefined;
    status: number;
  }) {
    super(
      `Umami API ${options.method} ${options.path} failed (${options.status}): ${options.message}`,
    );
    this.details = options.details;
    this.method = options.method;
    this.path = options.path;
    this.requestId = options.requestId;
    this.status = options.status;
  }
}

export class UmamiResponseTooLargeError extends Error {
  override readonly name = 'UmamiResponseTooLargeError';

  constructor(readonly maximumBytes: number) {
    super(`Umami response exceeded the configured ${maximumBytes}-byte limit`);
  }
}

type QueryPrimitive = boolean | number | string;
export type Query = Record<string, QueryPrimitive | readonly QueryPrimitive[] | null | undefined>;

export interface RequestOptions {
  body?: unknown;
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
  query?: Query;
  signal?: AbortSignal;
}

export interface UmamiClientOptions {
  authentication: Authentication;
  baseUrl: string;
  fetch?: typeof fetch;
  maxResponseBytes: number;
  timeoutMs: number;
}

function errorMessage(details: unknown, fallback: string): string {
  if (details && typeof details === 'object') {
    if ('message' in details && typeof details.message === 'string') return details.message;
    if ('error' in details && typeof details.error === 'string') return details.error;
  }
  return typeof details === 'string' && details ? details : fallback;
}

export class UmamiClient {
  readonly #authentication: Authentication;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #maxResponseBytes: number;
  readonly #timeoutMs: number;
  #loginPromise: Promise<string> | undefined;
  #token: string | undefined;

  constructor(options: UmamiClientOptions) {
    this.#authentication = options.authentication;
    this.#baseUrl = options.baseUrl;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#maxResponseBytes = options.maxResponseBytes;
    this.#timeoutMs = options.timeoutMs;
  }

  async request(path: string, options: RequestOptions = {}): Promise<unknown> {
    const method = options.method ?? 'GET';
    const url = this.#buildUrl(path, options.query);
    let token = await this.#getToken();
    let response = await this.#send(url, method, token, options);

    if (response.status === 401 && this.#authentication.type === 'password') {
      await response.body?.cancel();
      token = await this.#getToken(true);
      response = await this.#send(url, method, token, options);
    }

    const details = await this.#readResponse(response);
    if (!response.ok) {
      throw new UmamiApiError({
        details,
        message: errorMessage(details, response.statusText || 'Request failed'),
        method,
        path,
        requestId: response.headers.get('x-request-id') ?? undefined,
        status: response.status,
      });
    }
    return details;
  }

  #buildUrl(path: string, query: Query | undefined): URL {
    const url = new URL(`${this.#baseUrl}/${path.replace(/^\/+/, '')}`);
    for (const [name, rawValue] of Object.entries(query ?? {})) {
      if (rawValue === undefined || rawValue === null) continue;
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const entry of values) url.searchParams.append(name, String(entry));
    }
    return url;
  }

  async #getToken(forceRefresh = false): Promise<string> {
    const authentication = this.#authentication;
    if (authentication.type !== 'password') return authentication.value;
    if (forceRefresh) this.#token = undefined;
    if (this.#token) return this.#token;
    if (this.#loginPromise) return this.#loginPromise;

    this.#loginPromise = this.#login(authentication).finally(() => {
      this.#loginPromise = undefined;
    });
    this.#token = await this.#loginPromise;
    return this.#token;
  }

  async #login(authentication: Extract<Authentication, { type: 'password' }>): Promise<string> {
    const response = await this.#fetch(
      new Request(`${this.#baseUrl}/auth/login`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          username: authentication.username,
          password: authentication.password,
        }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      }),
    );
    const details = await this.#readResponse(response);
    if (!response.ok) {
      throw new UmamiApiError({
        details,
        message: errorMessage(details, response.statusText || 'Authentication failed'),
        method: 'POST',
        path: '/auth/login',
        requestId: response.headers.get('x-request-id') ?? undefined,
        status: response.status,
      });
    }
    if (
      details &&
      typeof details === 'object' &&
      'requiresTwoFactor' in details &&
      details.requiresTwoFactor === true
    ) {
      if (!('partialToken' in details) || typeof details.partialToken !== 'string') {
        throw new Error('Umami two-factor login response did not contain a partial token');
      }
      const twoFactorCode = authentication.twoFactorSecret
        ? generateTotp(authentication.twoFactorSecret)
        : authentication.twoFactorCode;
      if (!twoFactorCode) {
        throw new Error(
          'Umami requires two-factor authentication; configure UMAMI_TWO_FACTOR_SECRET',
        );
      }
      const verifyResponse = await this.#fetch(
        new Request(`${this.#baseUrl}/2fa/verify`, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${details.partialToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ token: twoFactorCode }),
          signal: AbortSignal.timeout(this.#timeoutMs),
        }),
      );
      const verifyDetails = await this.#readResponse(verifyResponse);
      if (!verifyResponse.ok) {
        throw new UmamiApiError({
          details: verifyDetails,
          message: errorMessage(
            verifyDetails,
            verifyResponse.statusText || 'Two-factor authentication failed',
          ),
          method: 'POST',
          path: '/2fa/verify',
          requestId: verifyResponse.headers.get('x-request-id') ?? undefined,
          status: verifyResponse.status,
        });
      }
      if (
        !verifyDetails ||
        typeof verifyDetails !== 'object' ||
        !('token' in verifyDetails) ||
        typeof verifyDetails.token !== 'string' ||
        !verifyDetails.token
      ) {
        throw new Error('Umami two-factor verification response did not contain a token');
      }
      return verifyDetails.token;
    }

    if (!details || typeof details !== 'object' || !('token' in details)) {
      throw new Error('Umami login response did not contain a token');
    }
    const token = details.token;
    if (typeof token !== 'string' || !token) {
      throw new Error('Umami login response contained an invalid token');
    }
    return token;
  }

  #send(
    url: URL,
    method: NonNullable<RequestOptions['method']>,
    token: string,
    options: RequestOptions,
  ): Promise<Response> {
    const headers = new Headers({
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    });
    const init: RequestInit = {
      method,
      headers,
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(this.#timeoutMs)])
        : AbortSignal.timeout(this.#timeoutMs),
    };
    if (options.body !== undefined) {
      headers.set('content-type', 'application/json');
      init.body = JSON.stringify(options.body);
    }
    return this.#fetch(new Request(url, init));
  }

  async #readResponse(response: Response): Promise<unknown> {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > this.#maxResponseBytes) {
      await response.body?.cancel();
      throw new UmamiResponseTooLargeError(this.#maxResponseBytes);
    }
    if (!response.body) return null;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let bytesRead = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > this.#maxResponseBytes) {
        await reader.cancel();
        throw new UmamiResponseTooLargeError(this.#maxResponseBytes);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    if (!text) return null;

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('json')) {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error('Umami returned malformed JSON');
      }
    }
    return text;
  }
}
