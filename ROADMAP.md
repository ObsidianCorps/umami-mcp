# Roadmap

The `0.1.x` line establishes a production-quality local and gateway-hosted server. Priorities after field testing:

- Add a conformance suite against disposable Umami v3 containers and Umami Cloud sandbox data.
- Add OAuth 2.1 resource-server helpers for direct public multi-user deployments.
- Add OpenTelemetry spans and opt-in metrics without recording payloads or credentials.
- Add capability probing so older self-hosted Umami installations can hide unsupported operations dynamically.
- Add focused compound analyses for anomaly detection, conversion comparison, and attribution while keeping raw evidence visible.
- Publish npm and OCI artifacts with provenance, then register the npm package in the official MCP Registry.

Compatibility work follows released Umami versions and published MCP specifications rather than unreleased main-branch behavior.
