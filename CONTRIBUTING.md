# Contributing

Thank you for helping improve the Umami MCP server.

## Workflow

1. Open an issue for substantial behavior or API-surface changes.
2. Create a focused branch and add a failing test for each behavior change.
3. Implement the smallest change that makes the test pass.
4. Run `npm run check` before opening a pull request.
5. Use a Conventional Commit subject such as `feat: add cohort comparison`.

Do not include Umami keys, tokens, passwords, analytics exports, replay payloads, or other customer data in issues, fixtures, snapshots, or logs. Tests should use synthetic UUIDs and responses.

## API changes

When updating Umami coverage, link the official Umami documentation or source route in the pull request and add a route-mapping test. When changing MCP behavior, link the applicable MCP specification or TypeScript SDK documentation.

Public tool names and schemas are API. Prefer extending an existing domain tool over adding narrowly duplicated tools, and document any breaking schema change in `CHANGELOG.md`.
