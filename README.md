# pr-review-mcp

MCP server for multi-track PR reviews from local git diffs.

**npm package:** `aggrowal-pr-review-mcp`

## Documentation

- [Configuration, modes, and usage](docs/config-modes.md)
- [Publishing to npm](docs/publishing.md)
- [Architecture and extendability](docs/architecture.md)

## Quickstart

1. Run via `npx`:

```bash
npx -y aggrowal-pr-review-mcp
```

2. Attach in your MCP client (Cursor/Claude-style example):

```json
{
  "mcpServers": {
    "pr-review": {
      "command": "npx",
      "args": ["-y", "aggrowal-pr-review-mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "your-anthropic-key"
      }
    }
  }
}
```

3. Configure project once:

```text
configure_project
  name: your-repo-folder
  repoUrl: https://github.com/org/repo
  mainBranch: main
```

4. Run review:

```text
@pr_review branch: feature/my-branch
```

The server emits progress logs during execution (`T1`, `T2`, `T3`, detection, assembly, execution) and returns machine-readable JSON.

## Review contract enforcement

Detailed reference: [docs/architecture.md#review-contract-enforcement](docs/architecture.md#review-contract-enforcement).

Core guarantees:

- Server builds a per-track execution contract from matched skill checklists.
- Final model output must satisfy schema and contract coverage checks.
- Missing/extra track, heading, or subpoint coverage causes correction retry and then structured error if unresolved.
- Status taxonomy remains: `blocker | needs_improvement | nudge | looks_good`.

## Token efficiency strategy

Detailed reference: [docs/architecture.md#token-efficiency-strategy](docs/architecture.md#token-efficiency-strategy).

Current strategy:

- Keep a single `pr_review` call from IDE.
- Inject shared changed-files payload once for all tracks.
- Remove repeated per-track prompt boilerplate while preserving checklist semantics.
- Emit prompt telemetry (`static`, `payload`, `tracks`, `total`) for visibility.
- Retry only when output is invalid or execution fails retryably.

## Skill prompt format contract (must keep)

Each skill prompt must keep this shape so parser and coverage validation remain stable:

- `## What to check`
- heading lines in `### <Letter>. <Title>` format
- numbered checks (`1.`, `2.`, ...)
- `## Rules`

If you change this format, update parser logic in `src/prompt/assemble.ts` and related tests.

## Prompt-injection hardening

Detailed reference: [docs/architecture.md#prompt-injection-hardening](docs/architecture.md#prompt-injection-hardening).

Hardening model:

- Treat diff and file payloads as untrusted data.
- Wrap untrusted content in sentinel boundaries.
- Escape sentinel collisions in payload.
- Keep reviewer `reviewInstructions` in trusted section only.

## Future change checklist

Before finalizing behavior changes:

1. Keep coverage-contract integrity for track/heading/subpoint accounting.
2. Keep skill parseability (`### Letter. Heading` + numbered checks).
3. Preserve token discipline via dedupe and concise wording.
4. Preserve trusted/untrusted boundary model and path sanitization.
5. Run `npm test` and `npm run build`.

## Development

```bash
npm run build
npm run dev
npm test
npm start
npm run smoke:mcp
```

