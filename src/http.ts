import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer as createNodeServer, type Server, type ServerResponse } from 'node:http';

import {
  hostHeaderValidation,
  localhostHostValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node';
import { createMcpHandler, type McpServer } from '@modelcontextprotocol/server';

import { serverInfo } from './server.js';

export interface HttpServerOptions {
  allowedHosts: string[];
  allowedOrigins: string[];
  bearerToken?: string | undefined;
  createServer: () => McpServer;
  host: string;
  port: number;
}

export interface HttpRuntime {
  close(): Promise<void>;
  server: Server;
  url: string;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function secretDigest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function hasBearer(header: string | undefined, expected: string): boolean {
  if (!header) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match?.[1]) return false;
  return timingSafeEqual(secretDigest(match[1]), secretDigest(expected));
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
}

function normalizedOrigins(origins: string[]): Set<string> {
  return new Set(
    origins.map((origin) => {
      try {
        return new URL(origin).origin;
      } catch {
        throw new Error(`Invalid MCP allowed origin: ${origin}`);
      }
    }),
  );
}

export async function startHttpServer(options: HttpServerOptions): Promise<HttpRuntime> {
  const loopback = LOOPBACK_HOSTS.has(options.host);
  if (!loopback && options.allowedHosts.length === 0) {
    throw new Error('At least one MCP allowed host is required for a non-loopback HTTP bind');
  }

  const allowedOrigins = normalizedOrigins(options.allowedOrigins);
  const validateHost = loopback
    ? localhostHostValidation()
    : hostHeaderValidation(options.allowedHosts);
  const mcpHandler = createMcpHandler(options.createServer);
  const nodeHandler = toNodeHandler(mcpHandler, {
    onerror: (error) => console.error('MCP HTTP handler error:', error),
  });

  const server = createNodeServer((request, reply) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname === '/health' && request.method === 'GET') {
      writeJson(reply, 200, {
        status: 'ok',
        server: serverInfo.name,
        version: serverInfo.version,
        targetUmamiVersion: serverInfo.targetUmamiVersion,
      });
      return;
    }
    if (pathname !== '/mcp') {
      writeJson(reply, 404, { error: 'Not found' });
      return;
    }
    if (!validateHost(request, reply)) return;

    const origin = request.headers.origin;
    if (origin) {
      let normalized: string;
      try {
        normalized = new URL(origin).origin;
      } catch {
        writeJson(reply, 403, { error: 'Forbidden origin' });
        return;
      }
      if (!allowedOrigins.has(normalized)) {
        writeJson(reply, 403, { error: 'Forbidden origin' });
        return;
      }
    }

    if (options.bearerToken && !hasBearer(request.headers.authorization, options.bearerToken)) {
      writeJson(
        reply,
        401,
        { error: 'Unauthorized' },
        { 'www-authenticate': 'Bearer realm="umami-mcp"' },
      );
      return;
    }
    void nodeHandler(request as Parameters<typeof nodeHandler>[0], reply);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options.port, options.host);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await mcpHandler.close();
    throw new Error('Could not determine MCP HTTP listener address');
  }
  const displayHost = options.host.includes(':')
    ? `[${options.host.replace(/^\[|\]$/g, '')}]`
    : options.host;

  return {
    server,
    url: `http://${displayHost}:${address.port}`,
    async close() {
      await mcpHandler.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}
