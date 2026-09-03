import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';

import { startHttpServer, type HttpRuntime } from '../src/http.js';
import { createUmamiServer } from '../src/server.js';
import type { UmamiApi } from '../src/umami/types.js';

const runtimes: HttpRuntime[] = [];
const clients: Client[] = [];

const api: UmamiApi = {
  request(path) {
    return Promise.resolve({ path });
  },
};

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
});

describe('Streamable HTTP runtime', () => {
  it('serves the current MCP protocol while protecting the endpoint', async () => {
    const runtime = await startHttpServer({
      host: '127.0.0.1',
      port: 0,
      bearerToken: 'mcp-secret',
      allowedHosts: [],
      allowedOrigins: ['https://trusted.example'],
      createServer: () => createUmamiServer({ api, defaultWebsiteId: 'site-id' }),
    });
    runtimes.push(runtime);

    await expect(
      fetch(`${runtime.url}/health`).then((response) => response.json()),
    ).resolves.toEqual({
      status: 'ok',
      server: '@obsidiancorps/umami-mcp',
      version: '0.1.0',
      targetUmamiVersion: '3.3.1',
    });

    const missing = await fetch(`${runtime.url}/mcp`, { method: 'POST' });
    const invalid = await fetch(`${runtime.url}/mcp`, {
      method: 'POST',
      headers: { authorization: 'Bearer wrong' },
    });
    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(await missing.text()).toBe(await invalid.text());

    const badOrigin = await fetch(`${runtime.url}/mcp`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer mcp-secret',
        origin: 'https://evil.example',
      },
    });
    expect(badOrigin.status).toBe(403);

    const client = new Client(
      { name: 'http-test-client', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    );
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${runtime.url}/mcp`), {
        requestInit: { headers: { authorization: 'Bearer mcp-secret' } },
      }),
    );
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(17);
  });

  it('returns 404 outside the MCP and health endpoints', async () => {
    const runtime = await startHttpServer({
      host: '127.0.0.1',
      port: 0,
      allowedHosts: [],
      allowedOrigins: [],
      createServer: () => createUmamiServer({ api }),
    });
    runtimes.push(runtime);

    const response = await fetch(`${runtime.url}/not-mcp`);
    expect(response.status).toBe(404);
  });
});
