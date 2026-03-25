# Configuration and Usage

This guide covers install, keyless staged review flow, config fields, and diagnostics.

## Install and attach MCP

Run from npm:

```bash
npx -y aggrowal-pr-review-mcp
```

Attach in an MCP client:

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

Notes:

- Use package name `aggrowal-pr-review-mcp` (not `pr-review-mcp`).
- Runtime is keyless; no provider API keys are required.

## Configure and run

Register a project once:

```text
configure_project
  name: notification-handler
  repoUrl: https://github.com/org/notification-handler
  mainBranch: main
```

Start review:

```text
@pr_review branch: feature/login
@pr_review branch: java21-upgrade reviewInstructions: Focus on migration regressions and test coverage.
@pr_review branch: feature/login format: markdown
```

`branch` stays explicit by design.

## Staged keyless flow

`pr_review` executes in strict stages:

1. **prepare**: server runs deterministic git/diff/skills assembly and returns:
   - `session.sessionId`
   - `payload.prompt`
   - `payload.trackContracts`
2. **validate**: host submits `draftReport` plus `sessionId`.
3. **repair** (if needed): server returns `validationIssues` + `payload.correctionPrompt`.
4. **final**: server returns validated review JSON and optional markdown.

If your IDE does not auto-chain, call validate manually:

```text
@pr_review sessionId: <from_prepare> draftReport: <json_report_string>
```

## Tool response shapes

Prepare:

```json
{
  "ok": true,
  "stage": "prepare",
  "session": { "sessionId": "...", "attempt": 0, "maxAttempts": 3, "expiresAt": "..." },
  "payload": { "prompt": "...", "trackContracts": [] },
  "nextAction": { "type": "generate_and_validate", "instructions": "..." }
}
```

Repair:

```json
{
  "ok": true,
  "stage": "repair",
  "session": { "sessionId": "...", "attempt": 1, "maxAttempts": 3, "expiresAt": "..." },
  "validationIssues": ["..."],
  "payload": { "correctionPrompt": "..." },
  "nextAction": { "type": "regenerate_and_validate", "instructions": "..." }
}
```

Final:

```json
{
  "ok": true,
  "stage": "final",
  "review": { "...": "..." },
  "meta": { "sessionId": "...", "validationAttempts": 2, "model": "optional" },
  "markdown": "optional summary"
}
```

Error:

```json
{
  "ok": false,
  "error": { "code": "...", "message": "...", "detail": "...", "retryable": false }
}
```

Common `error.code` values:

- `project_guard_failed`
- `branch_resolution_failed`
- `diff_extraction_failed`
- `budget_exceeded`
- `validate_request_invalid`
- `session_not_found`
- `session_expired`
- `validation_attempts_exhausted`

## Config reference

Runtime config is `~/.pr-review-mcp/config.json` under `reviewRuntime`.

Example:

```json
{
  "version": 1,
  "projects": {
    "notification-handler": {
      "repoUrl": "https://github.com/org/notification-handler",
      "mainBranch": "main"
    }
  },
  "logLevel": "info",
  "logFile": true,
  "reviewRuntime": {
    "maxValidationAttempts": 3,
    "sessionTtlMinutes": 30,
    "enrichment": {
      "enabled": false,
      "provider": "git",
      "maxCommits": 5
    },
    "tokenBudget": {
      "maxPromptChars": 400000,
      "maxFiles": 100,
      "maxTotalLines": 15000
    }
  }
}
```

Field summary:

| Field | Type | Default | Purpose |
|---|---|---|---|
| `maxValidationAttempts` | `1..8` | `3` | Maximum validate/repair loops per session. |
| `sessionTtlMinutes` | `5..240` | `30` | Session expiration for staged validation. |
| `enrichment.enabled` | `boolean` | `false` | Enable optional metadata enrichment. |
| `enrichment.provider` | `git \| github` | `git` | Enrichment backend. |
| `enrichment.maxCommits` | `1..20` | `5` | Commit scan cap for enrichment. |
| `tokenBudget.maxPromptChars` | `number` | `400000` | Prompt size guard. |
| `tokenBudget.maxFiles` | `number` | `100` | File count guard. |
| `tokenBudget.maxTotalLines` | `number` | `15000` | Total changed lines guard. |

Legacy provider/sampling keys are tolerated for backward compatibility but ignored.

## Logging and debugging

Sinks:

- `stderr` (always on)
- MCP logging notifications (when host supports logging capability UI)
- optional file sink

Log-level precedence:

1. CLI args (`--log-level`, `--log-file`)
2. environment (`PR_REVIEW_LOG`)
3. config file (`logLevel`, `logFile`)
4. defaults (`info`, file off)

Default file path: `~/.pr-review-mcp/debug.log`

## Smoke test

```bash
npm run build
npm run smoke:mcp
```

Recommended client check:

1. Restart MCP after config edits.
2. Run `list_projects`.
3. Run `@pr_review branch: <valid-branch>`.
4. Confirm you receive stage `prepare`, then stage `final` or `repair`.

