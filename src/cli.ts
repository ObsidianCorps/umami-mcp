#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { resolveConfig } from './config.js';
import { startHttpServer } from './http.js';
import { createUmamiServer, serverInfo } from './server.js';
import { UmamiClient } from './umami/client.js';

export async function main(env: Record<string, string | undefined> = process.env): Promise<void> {
  const config = resolveConfig(env);
  const api = new UmamiClient(config.umami);
  const createServer = () =>
    createUmamiServer({
      api,
      defaultWebsiteId: config.umami.defaultWebsiteId,
      writeTools: config.umami.writeTools,
      destructiveTools: config.umami.destructiveTools,
    });

  if (config.mcp.transport === 'stdio') {
    const handle = serveStdio(createServer);
    console.error(
      `${serverInfo.name} v${serverInfo.version} targeting Umami v${serverInfo.targetUmamiVersion} on stdio`,
    );
    const shutdown = () => {
      void handle.close();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return;
  }

  const runtime = await startHttpServer({
    host: config.mcp.host,
    port: config.mcp.port,
    bearerToken: config.mcp.bearerToken,
    allowedHosts: config.mcp.allowedHosts,
    allowedOrigins: config.mcp.allowedOrigins,
    createServer,
  });
  console.error(
    `${serverInfo.name} v${serverInfo.version} targeting Umami v${serverInfo.targetUmamiVersion} at ${runtime.url}/mcp`,
  );
  const shutdown = () => {
    void runtime.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (entrypoint === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
