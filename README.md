# ObsidianCorps Umami MCP

<!-- mcp-name: io.github.obsidiancorps/umami-mcp -->

A secure, model-friendly [Model Context Protocol](https://modelcontextprotocol.io/) server for [Umami Analytics](https://umami.is/). It targets **Umami v3.3.1** and the **2026-07-28 MCP protocol**, while retaining compatibility with 2025-era MCP clients.

> Status: pre-release `0.1.0`. The repository is ready for local use and review; the `npx` command becomes available after the first npm publication.

## Why this implementation

- Current Umami v3 coverage: revenue APIs, session replay, heatmaps, event/session property pivots and typed series, segments, cohorts, boards, links, pixels, Web Vitals reports, and the established analytics APIs.
- Compact model surface: 17 read tools organize the API around analytical workflows instead of advertising dozens of near-duplicate endpoint tools.
- Model-friendly inputs: website names/domains resolve automatically, one accessible website is selected automatically, and date ranges accept presets or exact ISO/epoch timestamps.
- Structured MCP results: every tool advertises an output schema and returns `structuredContent` plus readable JSON.
- Safe defaults: mutations are absent by default; destructive tools need a second opt-in and an exact target-specific confirmation string.
- Two modern transports: local stdio and stateless Streamable HTTP. Legacy HTTP+SSE is intentionally not carried forward.
- Defense in depth: response byte limits, request timeouts, HTTPS enforcement, token refresh, DNS-rebinding protection, exact origin checks, and constant-time MCP bearer checks.
- Cloud and self-hosted auth: Umami Cloud API keys, pre-issued self-hosted tokens, or lazy username/password login—including Umami v3.3+ two-factor verification—with a single refresh after `401`.

## Quick start

### From source today

Requirements: Node.js 20 or newer.

```bash
npm install
npm run build
UMAMI_API_KEY=your-key node dist/cli.js
```

### From npm after publication

```bash
UMAMI_API_KEY=your-key npx -y @obsidiancorps/umami-mcp
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "umami": {
      "command": "npx",
      "args": ["-y", "@obsidiancorps/umami-mcp"],
      "env": {
        "UMAMI_API_KEY": "your-key",
        "UMAMI_DEFAULT_WEBSITE_ID": "optional-website-uuid"
      }
    }
  }
}
```

For an unpublished checkout, replace the command with `node` and the arguments with the absolute path to `dist/cli.js`.

## Authentication

Choose exactly one mode:

| Mode                  | Variables                                                        | API base                              |
| --------------------- | ---------------------------------------------------------------- | ------------------------------------- |
| Umami Cloud           | `UMAMI_API_KEY`                                                  | Defaults to `https://api.umami.is/v1` |
| Self-hosted token     | `UMAMI_BASE_URL`, `UMAMI_TOKEN`                                  | `/api` is added to a root URL         |
| Self-hosted login     | `UMAMI_BASE_URL`, `UMAMI_USERNAME`, `UMAMI_PASSWORD`             | `/api` is added to a root URL         |
| Self-hosted login+2FA | Login variables plus `UMAMI_TWO_FACTOR_SECRET`                   | `/api` is added to a root URL         |
| One-off 2FA login     | Login variables plus a current six-digit `UMAMI_TWO_FACTOR_CODE` | `/api` is added to a root URL         |

`UMAMI_TWO_FACTOR_SECRET` is the Base32 setup seed shown when enrolling an authenticator. The MCP generates a six-digit SHA-1 TOTP just-in-time and never logs or returns it. Because storing the password and TOTP seed together removes the separation between factors, use a dedicated least-privilege Umami account and protect its environment. A pre-issued `UMAMI_TOKEN` avoids retaining either credential.

`UMAMI_TWO_FACTOR_CODE` is only a one-off fallback; it expires quickly and is unsuitable for normal MCP startup. Configure only one two-factor variable.

Non-local plain HTTP Umami URLs are rejected. For an explicitly trusted private network only, set `UMAMI_ALLOW_INSECURE_HTTP=true`.

## Tools

The default read-only set is:

| Tool                                           | Purpose                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `umami_check_connection`                       | Verify auth and inspect the current account                                                                              |
| `umami_list_websites`, `umami_get_website`     | Discover and inspect sites                                                                                               |
| `umami_get_overview`, `umami_get_metrics`      | Aggregate KPIs, series, and ranked dimensions                                                                            |
| `umami_get_realtime`                           | Inspect the current 30-minute activity window                                                                            |
| `umami_list_sessions`, `umami_inspect_session` | Browse sessions, activity, properties, and replay metadata                                                               |
| `umami_query_session_data`                     | Query session properties, pivots, stats, weekly traffic, and typed series                                                |
| `umami_list_events`, `umami_query_event_data`  | Browse events, comparison stats, series, properties, values, and pivots                                                  |
| `umami_get_revenue`                            | Fetch revenue stats, charts, dimensions, and sessions                                                                    |
| `umami_list_replays`                           | List replays or retrieve a replay event stream                                                                           |
| `umami_run_report`, `umami_list_reports`       | Run or discover funnel, journey, goal, retention, attribution, UTM, revenue, performance, breakdown, and heatmap reports |
| `umami_list_segments`                          | Discover segments and cohorts                                                                                            |
| `umami_list_assets`                            | Discover boards, tracked links, and pixels                                                                               |

Resources expose `umami://capabilities` and the live `umami://websites` list. Reusable prompts cover analytics review, conversion review, and realtime triage.

### Time ranges

Most analytical tools accept either:

- `period`: `last_24_hours`, `last_7_days`, `last_30_days`, `last_90_days`, `today`, `yesterday`, `this_week`, `last_week`, `this_month`, or `last_month`; or
- both `startAt` and `endAt` as epoch milliseconds or ISO 8601 timestamps with an offset.

Calendar periods honor the supplied IANA `timezone`. Rolling periods retain the most recent data instead of rounding to midnight.

## Mutations and destructive operations

No mutation tool is registered by default.

```bash
UMAMI_ENABLE_WRITE_TOOLS=true
```

This adds tools for creating/updating websites, segments, reports, boards/links/pixels, and sending analytics events. To additionally expose permanent reset/delete operations:

```bash
UMAMI_ENABLE_WRITE_TOOLS=true
UMAMI_ENABLE_DESTRUCTIVE_TOOLS=true
```

Destructive calls require confirmation strings such as `RESET <website-id>` or `DELETE reports <report-id>`. MCP annotations also identify these tools as destructive so supporting hosts can require approval.

## Streamable HTTP

Loopback example:

```bash
MCP_TRANSPORT=http MCP_BEARER_TOKEN=replace-me npm start
# MCP:    http://127.0.0.1:3000/mcp
# Health: http://127.0.0.1:3000/health
```

For a container or non-loopback bind, both `MCP_BEARER_TOKEN` and `MCP_ALLOWED_HOSTS` are required:

```bash
docker build -t umami-mcp .
docker run --rm -p 3000:3000 \
  -e UMAMI_API_KEY=your-key \
  -e MCP_BEARER_TOKEN=long-random-secret \
  -e MCP_ALLOWED_HOSTS=mcp.example.com \
  umami-mcp
```

Set `MCP_ALLOWED_ORIGINS` to a comma-separated list of exact browser origins if browser-based MCP clients connect. Requests without an `Origin` header remain valid for native clients. Terminate TLS at a trusted reverse proxy; the built-in static bearer gate is suitable behind that boundary, not a replacement for OAuth on a public multi-user service.

## Configuration reference

| Variable                         | Default                    | Description                                        |
| -------------------------------- | -------------------------- | -------------------------------------------------- |
| `UMAMI_BASE_URL`                 | Cloud API for API-key auth | Umami root or full API base URL                    |
| `UMAMI_DEFAULT_WEBSITE_ID`       | —                          | Avoids site resolution for most calls              |
| `UMAMI_TIMEOUT_MS`               | `15000`                    | Upstream request timeout, 100–120000 ms            |
| `UMAMI_MAX_RESPONSE_BYTES`       | `512000`                   | Maximum upstream response, 1 KB–10 MB              |
| `UMAMI_ENABLE_WRITE_TOOLS`       | `false`                    | Registers non-destructive mutation tools           |
| `UMAMI_ENABLE_DESTRUCTIVE_TOOLS` | `false`                    | Registers reset/delete tools; requires write tools |
| `MCP_TRANSPORT`                  | `stdio`                    | `stdio`, `http`, or `streamable-http`              |
| `MCP_HOST`                       | `127.0.0.1`                | HTTP bind address                                  |
| `MCP_PORT`                       | `3000`                     | HTTP port                                          |
| `MCP_BEARER_TOKEN`               | —                          | Protects the HTTP MCP endpoint                     |
| `MCP_ALLOWED_HOSTS`              | —                          | Comma-separated hostnames for non-loopback HTTP    |
| `MCP_ALLOWED_ORIGINS`            | —                          | Comma-separated exact browser origins              |

## Development

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run check
```

Tests drive the server through real in-memory, stdio, and Streamable HTTP MCP clients. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) before opening a change.

## Compatibility baseline

- Umami: v3.3.1, with compatibility expected for late v3 releases exposing the documented routes.
- MCP SDK: TypeScript SDK v2.0.0.
- MCP protocol: 2026-07-28 plus the SDK's stateless compatibility path for 2025-era clients.
- Node.js: 20, 22, and 24.

Umami is a trademark of its respective owner. This independent integration is not affiliated with or endorsed by Umami Software.

## License

Apache-2.0. See [LICENSE](LICENSE).
