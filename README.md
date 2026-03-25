# pr-review-mcp

MCP server for multi-track PR reviews from local git diffs.

**npm package:** `aggrowal-pr-review-mcp`

## Documentation

- [Platform setup (Cursor, Claude Code, Windsurf, etc.)](docs/platform-setup.md)
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
      "env": {}
    }
  }
}
```

This server is keyless by default. No Anthropic/OpenAI keys are required.

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
@pr_review branch: feature/my-branch format: markdown
```

`pr_review` now uses a strict staged loop:

- Stage `prepare`: server returns `sessionId`, assembled prompt, coverage contract, and `nextAction.callTemplate`.
- Stage `validate`: host sends a draft report back; server validates schema + contract.
- Stage `repair` (if needed): server returns exact gaps and a correction prompt.
- Stage `final`: server returns validated review JSON (and optional markdown summary).

Most IDE agents can chain this automatically after the initial `@pr_review branch: ...` call.  
If your host does not auto-chain, call `pr_review` again with `sessionId` + `draftReport`.

### Troubleshooting: checks do not kick in

Common bypass symptoms:

- Host returns free-form findings directly, but you do not see staged JSON envelopes with `ok`, `stage`, and `meta`.
- Response lacks `nextAction.callTemplate` from `prepare` or `repair`.
- MCP logs do not show `pr_review: prepare stage starting` and `pr_review: validate stage starting`.

Manual recovery flow:

1. Run `@pr_review branch: <branch-name>`.
2. Copy `nextAction.callTemplate` from the returned `prepare` payload.
3. Fill `draftReport` with your generated JSON report.
4. Call `pr_review` again with that payload.
5. Repeat with the returned `repair` call template until stage `final`.

Debug checklist:

- Set `PR_REVIEW_LOG=debug` in the MCP server environment.
- Re-run `@pr_review branch: <branch-name>`.
- Confirm stage logs appear in order: prepare start -> validate start -> (repair or final).
- If no stage logs appear, your host likely bypassed the MCP tool call.

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
- Retry through explicit staged validation when output fails schema/contract checks.

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

