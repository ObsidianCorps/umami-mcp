import { describe, expect, it } from 'vitest';

import { ConfigError, resolveConfig } from '../src/config.js';

describe('resolveConfig', () => {
  it('uses Umami Cloud defaults with an API key', () => {
    const config = resolveConfig({ UMAMI_API_KEY: 'cloud-secret' });

    expect(config.umami).toEqual({
      baseUrl: 'https://api.umami.is/v1',
      authentication: { type: 'api-key', value: 'cloud-secret' },
      defaultWebsiteId: undefined,
      destructiveTools: false,
      writeTools: false,
      maxResponseBytes: 512_000,
      timeoutMs: 15_000,
    });
    expect(config.mcp).toEqual({
      allowedHosts: [],
      allowedOrigins: [],
      bearerToken: undefined,
      host: '127.0.0.1',
      port: 3000,
      transport: 'stdio',
    });
  });

  it('supports a self-hosted username and password', () => {
    const config = resolveConfig({
      UMAMI_BASE_URL: 'https://analytics.example.com/',
      UMAMI_USERNAME: 'operator',
      UMAMI_PASSWORD: 'secret',
    });

    expect(config.umami.baseUrl).toBe('https://analytics.example.com/api');
    expect(config.umami.authentication).toEqual({
      type: 'password',
      username: 'operator',
      password: 'secret',
    });
  });

  it('accepts a current two-factor code with self-hosted password authentication', () => {
    const config = resolveConfig({
      UMAMI_BASE_URL: 'https://analytics.example.com',
      UMAMI_USERNAME: 'operator',
      UMAMI_PASSWORD: 'secret',
      UMAMI_TWO_FACTOR_CODE: '123456',
    });

    expect(config.umami.authentication).toEqual({
      type: 'password',
      username: 'operator',
      password: 'secret',
      twoFactorCode: '123456',
    });
  });

  it('accepts and normalizes a Base32 secret for automatic two-factor codes', () => {
    const config = resolveConfig({
      UMAMI_BASE_URL: 'https://analytics.example.com',
      UMAMI_USERNAME: 'operator',
      UMAMI_PASSWORD: 'secret',
      UMAMI_TWO_FACTOR_SECRET: 'gezd gnbv gy3t qojq gezd gnbv gy3t qojq',
    });

    expect(config.umami.authentication).toEqual({
      type: 'password',
      username: 'operator',
      password: 'secret',
      twoFactorSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    });
  });

  it('rejects a malformed two-factor code before attempting authentication', () => {
    expect(() =>
      resolveConfig({
        UMAMI_BASE_URL: 'https://analytics.example.com',
        UMAMI_USERNAME: 'operator',
        UMAMI_PASSWORD: 'secret',
        UMAMI_TWO_FACTOR_CODE: '12345x',
      }),
    ).toThrowError(/UMAMI_TWO_FACTOR_CODE must be exactly 6 digits/);
  });

  it('rejects a malformed two-factor secret before attempting authentication', () => {
    expect(() =>
      resolveConfig({
        UMAMI_BASE_URL: 'https://analytics.example.com',
        UMAMI_USERNAME: 'operator',
        UMAMI_PASSWORD: 'secret',
        UMAMI_TWO_FACTOR_SECRET: 'not-a-base32-secret!',
      }),
    ).toThrowError(/UMAMI_TWO_FACTOR_SECRET must be a Base32 secret/);
  });

  it('rejects ambiguous two-factor inputs', () => {
    expect(() =>
      resolveConfig({
        UMAMI_BASE_URL: 'https://analytics.example.com',
        UMAMI_USERNAME: 'operator',
        UMAMI_PASSWORD: 'secret',
        UMAMI_TWO_FACTOR_CODE: '123456',
        UMAMI_TWO_FACTOR_SECRET: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      }),
    ).toThrowError(/Configure only one of UMAMI_TWO_FACTOR_CODE or UMAMI_TWO_FACTOR_SECRET/);
  });

  it('allows two-factor settings only with self-hosted password authentication', () => {
    expect(() =>
      resolveConfig({
        UMAMI_API_KEY: 'cloud-secret',
        UMAMI_TWO_FACTOR_SECRET: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      }),
    ).toThrowError(/Two-factor settings require UMAMI_USERNAME and UMAMI_PASSWORD/);
  });

  it('accepts a pre-issued self-hosted token', () => {
    const config = resolveConfig({
      UMAMI_BASE_URL: 'http://127.0.0.1:3000/api/',
      UMAMI_TOKEN: 'jwt',
    });

    expect(config.umami.baseUrl).toBe('http://127.0.0.1:3000/api');
    expect(config.umami.authentication).toEqual({ type: 'token', value: 'jwt' });
  });

  it('rejects ambiguous credential modes', () => {
    expect(() =>
      resolveConfig({
        UMAMI_API_KEY: 'key',
        UMAMI_TOKEN: 'token',
      }),
    ).toThrowError(new ConfigError('Configure exactly one Umami authentication mode'));
  });

  it('rejects non-local cleartext Umami URLs by default', () => {
    expect(() =>
      resolveConfig({
        UMAMI_BASE_URL: 'http://analytics.example.com',
        UMAMI_TOKEN: 'token',
      }),
    ).toThrowError(/UMAMI_ALLOW_INSECURE_HTTP/);
  });

  it('requires MCP authentication when HTTP binds beyond loopback', () => {
    expect(() =>
      resolveConfig({
        UMAMI_API_KEY: 'key',
        MCP_TRANSPORT: 'http',
        MCP_HOST: '0.0.0.0',
      }),
    ).toThrowError(/MCP_BEARER_TOKEN/);
  });

  it('requires an explicit host allowlist when HTTP binds beyond loopback', () => {
    expect(() =>
      resolveConfig({
        UMAMI_API_KEY: 'key',
        MCP_TRANSPORT: 'http',
        MCP_HOST: '0.0.0.0',
        MCP_BEARER_TOKEN: 'mcp-secret',
      }),
    ).toThrowError(/MCP_ALLOWED_HOSTS/);
  });

  it('parses bounded numeric and comma-separated options', () => {
    const config = resolveConfig({
      UMAMI_API_KEY: 'key',
      UMAMI_DEFAULT_WEBSITE_ID: 'site-id',
      UMAMI_MAX_RESPONSE_BYTES: '1024',
      UMAMI_TIMEOUT_MS: '2500',
      MCP_TRANSPORT: 'http',
      MCP_PORT: '4040',
      MCP_ALLOWED_HOSTS: 'mcp.example.com, localhost ',
      MCP_ALLOWED_ORIGINS: 'https://one.example, https://two.example ',
    });

    expect(config.umami.defaultWebsiteId).toBe('site-id');
    expect(config.umami.maxResponseBytes).toBe(1024);
    expect(config.umami.timeoutMs).toBe(2500);
    expect(config.mcp.port).toBe(4040);
    expect(config.mcp.allowedHosts).toEqual(['mcp.example.com', 'localhost']);
    expect(config.mcp.allowedOrigins).toEqual(['https://one.example', 'https://two.example']);
  });

  it('makes mutations explicitly opt-in and gates destructive tools separately', () => {
    const enabled = resolveConfig({
      UMAMI_API_KEY: 'key',
      UMAMI_ENABLE_WRITE_TOOLS: 'true',
      UMAMI_ENABLE_DESTRUCTIVE_TOOLS: 'true',
    });
    expect(enabled.umami.writeTools).toBe(true);
    expect(enabled.umami.destructiveTools).toBe(true);

    expect(() =>
      resolveConfig({
        UMAMI_API_KEY: 'key',
        UMAMI_ENABLE_DESTRUCTIVE_TOOLS: 'true',
      }),
    ).toThrowError(/UMAMI_ENABLE_WRITE_TOOLS/);
  });
});
