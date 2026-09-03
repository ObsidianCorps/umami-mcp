import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('stdio executable', () => {
  it('starts cleanly and exposes the MCP toolset without stdout noise', async () => {
    const client = new Client({ name: 'stdio-test-client', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['node_modules/tsx/dist/cli.mjs', 'src/cli.ts'],
      cwd: process.cwd(),
      env: {
        UMAMI_API_KEY: 'not-called-during-discovery',
        PATH: process.env.PATH ?? '',
      },
      stderr: 'pipe',
    });

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(17);
    } finally {
      await client.close();
    }
  });

  it('exposes opt-in write tools from environment configuration', async () => {
    const client = new Client({ name: 'stdio-write-test-client', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['node_modules/tsx/dist/cli.mjs', 'src/cli.ts'],
      cwd: process.cwd(),
      env: {
        UMAMI_API_KEY: 'not-called-during-discovery',
        UMAMI_ENABLE_WRITE_TOOLS: 'true',
        PATH: process.env.PATH ?? '',
      },
      stderr: 'pipe',
    });

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(22);
    } finally {
      await client.close();
    }
  });

  it('starts through an npm-style executable symlink', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'umami-mcp-stdio-'));
    const entrypoint = join(directory, 'umami-mcp');
    await symlink(join(process.cwd(), 'src/cli.ts'), entrypoint);

    const client = new Client({ name: 'stdio-symlink-test-client', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['node_modules/tsx/dist/cli.mjs', entrypoint],
      cwd: process.cwd(),
      env: {
        UMAMI_API_KEY: 'not-called-during-discovery',
        PATH: process.env.PATH ?? '',
      },
      stderr: 'pipe',
    });

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(17);
    } finally {
      await client.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
