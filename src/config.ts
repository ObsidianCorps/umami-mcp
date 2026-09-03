export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export type Authentication =
  | { type: 'api-key'; value: string }
  | { type: 'token'; value: string }
  | {
      type: 'password';
      username: string;
      password: string;
      twoFactorCode?: string;
      twoFactorSecret?: string;
    };

export interface Config {
  umami: {
    baseUrl: string;
    authentication: Authentication;
    defaultWebsiteId: string | undefined;
    destructiveTools: boolean;
    maxResponseBytes: number;
    timeoutMs: number;
    writeTools: boolean;
  };
  mcp: {
    allowedHosts: string[];
    allowedOrigins: string[];
    bearerToken: string | undefined;
    host: string;
    port: number;
    transport: 'stdio' | 'http';
  };
}

function value(env: Record<string, string | undefined>, name: string): string | undefined {
  const candidate = env[name]?.trim();
  return candidate ? candidate : undefined;
}

function parseInteger(
  raw: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (raw === undefined) return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ConfigError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseBoolean(raw: string | undefined, name: string): boolean {
  if (raw === undefined || raw === 'false') return false;
  if (raw === 'true') return true;
  throw new ConfigError(`${name} must be true or false`);
}

function resolveAuthentication(env: Record<string, string | undefined>): Authentication {
  const apiKey = value(env, 'UMAMI_API_KEY');
  const token = value(env, 'UMAMI_TOKEN');
  const username = value(env, 'UMAMI_USERNAME');
  const password = value(env, 'UMAMI_PASSWORD');
  const twoFactorCode = value(env, 'UMAMI_TWO_FACTOR_CODE');
  const twoFactorSecret = value(env, 'UMAMI_TWO_FACTOR_SECRET')?.replace(/\s+/g, '').toUpperCase();

  if ((username && !password) || (!username && password)) {
    throw new ConfigError('UMAMI_USERNAME and UMAMI_PASSWORD must be configured together');
  }
  if (twoFactorCode && twoFactorSecret) {
    throw new ConfigError('Configure only one of UMAMI_TWO_FACTOR_CODE or UMAMI_TWO_FACTOR_SECRET');
  }
  if ((twoFactorCode || twoFactorSecret) && !username) {
    throw new ConfigError('Two-factor settings require UMAMI_USERNAME and UMAMI_PASSWORD');
  }
  if (twoFactorCode && !/^\d{6}$/.test(twoFactorCode)) {
    throw new ConfigError('UMAMI_TWO_FACTOR_CODE must be exactly 6 digits');
  }
  if (twoFactorSecret && !/^[A-Z2-7]{16,128}$/.test(twoFactorSecret)) {
    throw new ConfigError(
      'UMAMI_TWO_FACTOR_SECRET must be a Base32 secret between 16 and 128 characters',
    );
  }

  const configuredModes =
    Number(Boolean(apiKey)) + Number(Boolean(token)) + Number(Boolean(username));
  if (configuredModes !== 1) {
    throw new ConfigError('Configure exactly one Umami authentication mode');
  }

  if (apiKey) return { type: 'api-key', value: apiKey };
  if (token) return { type: 'token', value: token };
  return {
    type: 'password',
    username: username!,
    password: password!,
    ...(twoFactorCode ? { twoFactorCode } : {}),
    ...(twoFactorSecret ? { twoFactorSecret } : {}),
  };
}

function resolveBaseUrl(
  raw: string | undefined,
  authentication: Authentication,
  allowInsecureHttp: boolean,
): string {
  if (!raw && authentication.type !== 'api-key') {
    throw new ConfigError('UMAMI_BASE_URL is required for self-hosted authentication');
  }

  let url: URL;
  try {
    url = new URL(raw ?? 'https://api.umami.is/v1');
  } catch {
    throw new ConfigError('UMAMI_BASE_URL must be a valid absolute URL');
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new ConfigError(
      'UMAMI_BASE_URL cannot contain credentials, query parameters, or a fragment',
    );
  }

  const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && (isLoopback || allowInsecureHttp))
  ) {
    throw new ConfigError(
      'UMAMI_BASE_URL must use HTTPS; set UMAMI_ALLOW_INSECURE_HTTP=true only for a trusted network',
    );
  }

  const path = url.pathname.replace(/\/+$/, '');
  if (!path) {
    url.pathname = url.hostname === 'api.umami.is' ? '/v1' : '/api';
  } else {
    url.pathname = path;
  }

  return url.toString().replace(/\/$/, '');
}

export function resolveConfig(env: Record<string, string | undefined>): Config {
  const authentication = resolveAuthentication(env);
  const writeTools = parseBoolean(
    value(env, 'UMAMI_ENABLE_WRITE_TOOLS'),
    'UMAMI_ENABLE_WRITE_TOOLS',
  );
  const destructiveTools = parseBoolean(
    value(env, 'UMAMI_ENABLE_DESTRUCTIVE_TOOLS'),
    'UMAMI_ENABLE_DESTRUCTIVE_TOOLS',
  );
  if (destructiveTools && !writeTools) {
    throw new ConfigError(
      'UMAMI_ENABLE_WRITE_TOOLS must be true before UMAMI_ENABLE_DESTRUCTIVE_TOOLS can be enabled',
    );
  }
  const transportValue = value(env, 'MCP_TRANSPORT') ?? 'stdio';
  if (!['stdio', 'http', 'streamable-http'].includes(transportValue)) {
    throw new ConfigError('MCP_TRANSPORT must be stdio or http');
  }
  const transport: 'stdio' | 'http' = transportValue === 'stdio' ? 'stdio' : 'http';
  const host = value(env, 'MCP_HOST') ?? '127.0.0.1';
  const bearerToken = value(env, 'MCP_BEARER_TOKEN');
  const allowedHosts = (value(env, 'MCP_ALLOWED_HOSTS') ?? '')
    .split(',')
    .map((hostname) => hostname.trim())
    .filter(Boolean);
  const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
  if (transport === 'http' && !isLoopback && !bearerToken) {
    throw new ConfigError('MCP_BEARER_TOKEN is required when MCP_HOST is not loopback');
  }
  if (transport === 'http' && !isLoopback && allowedHosts.length === 0) {
    throw new ConfigError('MCP_ALLOWED_HOSTS is required when MCP_HOST is not loopback');
  }

  return {
    umami: {
      baseUrl: resolveBaseUrl(
        value(env, 'UMAMI_BASE_URL'),
        authentication,
        value(env, 'UMAMI_ALLOW_INSECURE_HTTP') === 'true',
      ),
      authentication,
      defaultWebsiteId: value(env, 'UMAMI_DEFAULT_WEBSITE_ID'),
      destructiveTools,
      maxResponseBytes: parseInteger(
        value(env, 'UMAMI_MAX_RESPONSE_BYTES'),
        'UMAMI_MAX_RESPONSE_BYTES',
        512_000,
        1024,
        10_000_000,
      ),
      timeoutMs: parseInteger(
        value(env, 'UMAMI_TIMEOUT_MS'),
        'UMAMI_TIMEOUT_MS',
        15_000,
        100,
        120_000,
      ),
      writeTools,
    },
    mcp: {
      allowedHosts,
      allowedOrigins: (value(env, 'MCP_ALLOWED_ORIGINS') ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
      bearerToken,
      host,
      port: parseInteger(value(env, 'MCP_PORT'), 'MCP_PORT', 3000, 1, 65_535),
      transport,
    },
  };
}
