# Changelog

All notable changes will be documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-09-03

### Fixed

- Resolve npm executable symlinks before CLI entrypoint detection so `npx` starts the MCP server correctly.
- Skip an npm version that is already public when retrying the release workflow, allowing registry publication to continue safely.

## [0.1.0] - 2026-09-03

### Added

- Umami v3.3.1 analytics coverage through 17 compact read-only tools.
- Revenue, session replay, heatmap, event/session property, segments, cohorts, boards, links, and pixels support.
- Five opt-in write tools and two separately gated destructive tools.
- Umami Cloud, self-hosted token, and self-hosted username/password authentication.
- Umami v3.3+ two-factor verification, including automatic RFC 6238 code generation from a protected Base32 seed.
- MCP SDK v2 stdio and Streamable HTTP transports.
- Structured outputs, resources, prompts, date presets, website resolution, response limits, and transport hardening.
- A 25-second product demo and reproducible Remotion source.
- Multi-architecture GHCR publishing with provenance and an SBOM.
- Automated npm and official MCP Registry release publishing.

[Unreleased]: https://github.com/obsidiancorps/umami-mcp/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/obsidiancorps/umami-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/obsidiancorps/umami-mcp/releases/tag/v0.1.0
