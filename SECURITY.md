# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories on the `obsidiancorps/umami-mcp` repository. Do not open a public issue with exploit details, credentials, analytics data, or replay payloads.

Include the affected version, transport, deployment shape, reproduction steps, and impact. We will acknowledge a complete report as soon as practical and coordinate disclosure after a fix is available.

## Deployment assumptions

- Prefer stdio for single-user local clients.
- Treat Umami credentials and `MCP_BEARER_TOKEN` as secrets; never pass them as CLI arguments or commit them.
- Put non-loopback HTTP deployments behind TLS and a trusted reverse proxy.
- Configure an explicit host allowlist. Configure exact allowed origins only for browser clients that need them.
- The static bearer gate is intended for a trusted gateway boundary. Public multi-user deployments should add standards-based OAuth authorization in front of the MCP handler.
- Leave write and destructive tools disabled unless the connected client and operator genuinely need them.
- Session replay and custom event/session properties can contain sensitive data. Scope Umami permissions and response limits accordingly.

Supported security fixes target the latest released minor version. Older versions may be asked to upgrade before a patch is provided.
