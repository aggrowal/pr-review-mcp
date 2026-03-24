# Configuration, Modes, and Usage

This guide covers installation, MCP attachment, running reviews, runtime modes, and config behavior.

## Install and attach MCP

Install/run from npm:

```bash
npx -y aggrowal-pr-review-mcp
```

Attach in an MCP client (Cursor/Claude-style shape):

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

Notes:

- Use package name `aggrowal-pr-review-mcp` (not `pr-review-mcp`).
- MCP hosts do not always inherit your shell environment. Put required env vars in MCP config.

## Configure and use

Register project once:

```text
configure_project
  name: notification-handler
  repoUrl: https://github.com/org/notification-handler
  mainBranch: main
```

Run review:

```text
@pr_review branch: feature/login
@pr_review branch: fix/JIRA-1234-null-check
@pr_review branch: java21-upgrade reviewInstructions: Focus on upgrade regressions and test coverage.
```

`branch` is intentionally explicit. The tool does not default to current branch.

## Tool output shape

`pr_review` returns JSON only.

Success:

```json
{ "ok": true, "review": { "...": "..." }, "meta": { "...": "..." } }
```

Error:

```json
{ "ok": false, "error": { "code": "...", "message": "...", "detail": "...", "retryable": false } }
```

Common `error.code` values:

- `project_guard_failed`
- `branch_resolution_failed`
- `diff_extraction_failed`
- `sampling_unavailable`
- `sampling_failed`
- `provider_error`
- `invalid_output`
- `schema_invalid`
- `contract_invalid`

## Runtime modes

Runtime configuration lives in `~/.pr-review-mcp/config.json` under `reviewRuntime`.

| Mode | What happens | Best for |
|---|---|---|
| `auto` (default) | Try MCP client sampling first; fallback to provider API if sampling unavailable. | Mixed-client environments; safest default. |
| `client_sampling` | Use model from host/client chat context only. | Local/host-managed model execution, no direct provider token dependency. |
| `provider_api` | Call Anthropic/OpenAI directly from server. | Strict provider control or clients without sampling support. |

## Local LLM (IDE context) vs token mode

### IDE/chat-window context path

- Set `executionMode` to `client_sampling` (or keep `auto`).
- Server sends `sampling/createMessage` to the client.
- Client chooses model from its active context (including local model backends when supported).
- No provider API token required for this path.

### Token/API path

- Set `executionMode` to `provider_api` (or keep `auto` with fallback enabled).
- Configure `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in MCP `env`.
- Server calls provider API directly.

Recommended production stance: keep `auto` and configure provider keys to ensure fallback continuity.

## Full config reference

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
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-latest",
    "timeoutMs": 45000,
    "maxRetries": 1,
    "maxOutputTokens": 4096,
    "temperature": 0,
    "executionMode": "auto",
    "samplingIncludeContext": "none",
    "samplingModelHint": "claude",
    "enrichment": {
      "enabled": false,
      "provider": "git",
      "maxCommits": 5
    }
  }
}
```

Field summary:

| Field | Type | Default | Purpose |
|---|---|---|---|
| `provider` | `anthropic \| openai` | `anthropic` | Provider fallback and explicit provider mode. |
| `model` | `string` | provider default | Preferred provider model. |
| `timeoutMs` | `number` | `45000` | LLM request timeout. |
| `maxRetries` | `0..3` | `1` | Retry attempts for invalid/retryable outcomes. |
| `maxOutputTokens` | `number` | provider default | Output size guard. |
| `temperature` | `0..1` | provider default | Generation variability. |
| `executionMode` | `auto \| client_sampling \| provider_api` | `auto` | Execution routing. |
| `samplingIncludeContext` | `none \| thisServer \| allServers` | `none` | Sampling context scope hint. |
| `samplingModelHint` | `string` | unset | Sampling model preference hint. |
| `enrichment.enabled` | `boolean` | `false` | Enable optional metadata enrichment. |
| `enrichment.provider` | `git` | `git` | Current enrichment backend. |
| `enrichment.maxCommits` | `1..20` | `5` | Commit scan cap for enrichment. |

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

## Cross-client compatibility and smoke tests

| Client | Transport | Tools | Sampling support | Notes |
|---|---|---|---|---|
| Cursor | stdio | yes | version-dependent | Keep fallback keys configured in `auto`. |
| Claude Code | stdio | yes | version-dependent | Same command/args/env pattern. |
| Windsurf | MCP-compatible stdio | expected | version-dependent | Validate in installed client build. |
| Other MCP clients | varies | varies | varies | Requires stdio + tools; sampling optional. |

Maintainer smoke test:

```bash
npm run build
npm run smoke:mcp
```

Per-client checklist:

1. Restart MCP after config edits.
2. Verify `list_projects` succeeds.
3. Run `configure_project` inside target repo.
4. Run `@pr_review branch: <valid-branch>`.
5. Validate JSON output + progress logs.

