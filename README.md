# pr-review-mcp

**npm package:** `aggrowal-pr-review-mcp` — use this name with `npx`, not the unrelated package `pr-review-mcp`. (As of the last registry check, `aggrowal-pr-review-mcp` was not published yet, so the name is free to claim on first `npm publish`.)

A configurable MCP server for intelligent, multi-track PR reviews from **local git** diffs. Plugs into Claude Code, Cursor, Windsurf, or any MCP-compatible IDE.

## How it works

```
User: @pr_review branch: feature/login
  |
T1 -- Project guard     checks current dir matches a configured project
T2 -- Branch resolver   validates the branch exists locally
T3 -- Diff extractor    git diff via local git (merge-base strategy)
  |
Orchestrator            detects language / frameworks / patterns from diff
Skill filter            each skill declares requirements; non-matches skipped
  |
Assembled prompt        trusted instructions + shared changed-file payload + matched tracks
  |
LLM execution           server calls configured provider (Anthropic/OpenAI)
  |
JSON output             validated contract report returned by tool
```

## Review contract enforcement

The server assembles an explicit execution contract for matched tracks, executes the review through a configured LLM provider, and validates the JSON result before returning it.

- **Track execution contract (server-generated):** For each `## TRACK`, the assembler extracts:
  - heading ids/titles from `### A. Heading`
  - numbered sub-points from `1.`, `2.`, ...
  - compact sub-point ranges for validation guidance
- **Required output coverage:** The JSON contract requires `trackCoverage` with:
  - each executed track
  - per-heading status (`blocker | needs_improvement | nudge | looks_good`)
  - passed/failed sub-point ids
  - reason when any sub-point fails
  - explicit `"all pointers are positive"` when no sub-point fails
- **Output-side compliance marker:** The JSON output requires:
  - `contractCompliance.status: PASS | FAIL`
  - if `FAIL`, `contractCompliance.gaps` and `contractCompliance.reason` must identify missing track/heading/sub-point coverage
- **Verdict guidance:** Statuses map to `APPROVE` / `NEEDS_DISCUSSION` / `REQUEST_CHANGES` rules in the JSON output instructions.

Important architecture note: this MCP server now validates model output against schema and coverage contract before returning JSON to the client.

### Interpreting omissions

If a model response omits any `[run]` track, heading, or required sub-point accounting, the server treats it as contract non-compliance and retries once with corrective instructions before failing with a machine-readable error.

## Token efficiency strategy

Token reduction is applied without dropping review context:

- **Single-tool-call flow:** Keep one `pr_review` call from the IDE; server performs execution/validation internally.
- **Shared payload once:** Changed files payload is injected once and shared across all tracks.
- **Track prompt compaction:** Repeated per-track intro boilerplate is removed at assembly time; checklists and rules remain intact.
- **Lossless payload dedupe:** For `added` files, avoid duplicating `Full file` when diff already contains full content.
- **Concise instruction language:** Server-side guidance is written in short, direct language to reduce token overhead.
- **Prompt telemetry:** Assembly logs emit `static`, `payload`, `tracks`, and `total` char counts.
- **Retry discipline:** Retry model execution only for invalid/failed responses (bounded by `reviewRuntime.maxRetries`).

## Setup

### 1. Install (end users, via npx)

End users install the published npm package **`aggrowal-pr-review-mcp`**. It runs **local `git` diffs** plus multi-track LLM review—not the GitHub GraphQL server behind the older npm name `pr-review-mcp`.

```bash
npx -y aggrowal-pr-review-mcp
```

Cursor and other MCP hosts do not pass through your shell environment unless you configure it; put API keys in the MCP `env` block below.

Until this package is **published** to npm from a maintainer checkout, that command will not resolve from the registry. Use [local development](#3-local-development-maintainers) or a `npm pack` tarball path in MCP until then.

**Do not** use `npx -y pr-review-mcp`. That unscoped name on npm is a **different** project ([thebtf/pr-review-mcp](https://www.npmjs.com/package/pr-review-mcp)) that requires `GITHUB_PERSONAL_ACCESS_TOKEN` and is not this codebase.

Set **`ANTHROPIC_API_KEY`** and/or **`OPENAI_API_KEY`** depending on `reviewRuntime.provider` in `~/.pr-review-mcp/config.json` (defaults to Anthropic). When `reviewRuntime.provider` is `openai`, include `OPENAI_API_KEY` in MCP `env`.

### 2. Register with your IDE

**Cursor** -- copy [.cursor/mcp.json.example](.cursor/mcp.json.example) to `.cursor/mcp.json`, set your API key(s), restart MCP:

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

**Claude Code** -- add to `~/.config/claude-code/mcp.json` (or project `.mcp.json`) using the same `command`, `args`, and `env` shape as above.

### 3. Local development (maintainers)

Clone, build, and point MCP at `dist/index.js` while iterating (no publish required):

```bash
cd pr-review-mcp
npm install
npm run build
```

```json
{
  "mcpServers": {
    "pr-review": {
      "command": "node",
      "args": ["/absolute/path/to/pr-review-mcp/dist/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "your-anthropic-key"
      }
    }
  }
}
```

To **exercise the same npx path as users** before a release, from the repo root:

```bash
npm run build
npm pack
```

The tarball is named `aggrowal-pr-review-mcp-0.1.0.tgz` (version may differ). To test that artifact without publishing, use MCP `command` `npx` and `args` `["-y", "/absolute/path/to/aggrowal-pr-review-mcp-0.1.0.tgz"]` after `npm pack`.

### 4. Publishing and discoverability (maintainers)

**npm (required for `npx`)** — The registry holds the tarball; `npx -y aggrowal-pr-review-mcp` downloads and runs it.

**CI: publish on every push to `main`** — [.github/workflows/publish-npm.yml](.github/workflows/publish-npm.yml) runs `npm ci`, `npm test`, `npm run build`, bumps the **patch** version in `package.json`, runs `npm publish`, then commits `package.json` and `package-lock.json` back to `main` with `[skip ci]` in the message so the workflow does not loop.

Configure these **GitHub repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Purpose |
|--------|---------|
| `NPM_TOKEN` | Required. npm [granular access token](https://docs.npmjs.com/about-access-tokens) (or automation token) with permission to publish `aggrowal-pr-review-mcp`. |
| `RELEASE_GITHUB_TOKEN` | Optional. A personal access token with `contents: write` on this repo. Use if [branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) blocks the default `GITHUB_TOKEN` from pushing the version-bump commit to `main`. If unset, the workflow uses `github.token`. |

You can also trigger a publish manually from the Actions tab (**workflow_dispatch**).

**Manual publish** from a clean checkout (if you are not using CI):

```bash
npm login
npm run build
npm publish
```

**Official MCP Registry (optional, preview)** — The [Model Context Protocol registry](https://modelcontextprotocol.io/registry/quickstart) hosts **metadata** only; clients still install from npm. To list this server there after npm publish:

1. Keep `mcpName` in [package.json](package.json) aligned with your GitHub identity (`io.github.<user>/...` for GitHub-based registry auth).
2. Install [mcp-publisher](https://modelcontextprotocol.io/registry/quickstart) (`brew install mcp-publisher` or the release binary).
3. Run `mcp-publisher init` in this repo, edit `server.json` so `name` matches `mcpName` and `packages[0].identifier` is `aggrowal-pr-review-mcp`.
4. `mcp-publisher login github` then `mcp-publisher publish`.

Registry docs note the product is in preview; see [quickstart](https://modelcontextprotocol.io/registry/quickstart) for troubleshooting.

If you **rename the npm package**, update `name` in `package.json`, `mcpName` (if you use the registry), this README, [.cursor/mcp.json.example](.cursor/mcp.json.example), and `server.json` after re-running or editing `mcp-publisher init`.

### 5. Configure a project (one-time per project)

From inside the IDE, call the tool:

```
configure_project
  name: notification-handler
  repoUrl: https://github.com/org/notification-handler
  mainBranch: main
```

This writes to `~/.pr-review-mcp/config.json`. Do this once; it persists.
Update anytime by calling `configure_project` again with the same name.

### 6. Run a review

Branch name is always required -- no defaulting to current branch, to prevent accidental reviews.

```
@pr_review branch: feature/login
@pr_review branch: fix/JIRA-1234-payment-null-check
@pr_review branch: java21-upgrade reviewInstructions: Focus on upgrade regressions, test execution coverage, and config compatibility.
```

`pr_review` now returns JSON only:
- success shape: `{ ok: true, review: { ... }, meta: { ... } }`
- error shape: `{ ok: false, error: { code, message, detail?, retryable } }`

`reviewInstructions` is an optional trusted channel for reviewer focus.
Use it to add priorities, but required track execution and JSON contract rules still apply.
Keep it concise (max 2000 characters).

### 7. Troubleshooting output changes

If review behavior does not reflect recent code changes:

1. Rebuild the server:

```bash
npm run build
```

2. Restart the MCP server process from your IDE so it reloads `dist/index.js`.
3. Re-run `@pr_review` and confirm updated JSON fields/contract behavior in the output.

## Adding a new skill

1. Create a folder: `src/skills/my-skill/`
2. Create `index.ts` with two exports:

```typescript
import type { SkillMetadata, DiffContext, DetectedContext } from "../../types.js";

export const metadata: SkillMetadata = {
  id: "my-skill",
  name: "My custom review",
  description: "What this skill checks for.",
  requires: {
    language: ["typescript"],      // or ["*"] for all languages
    framework: ["nestjs"],         // or ["*"] for all frameworks
  },
  produces: "my-track",
};

export function buildPrompt(_diff: DiffContext, ctx: DetectedContext): string {
  return `Review code in a ${ctx.language} project for [your concern].
Use the shared changed-files payload provided by the parent prompt.

## What to check
1. ...
2. ...

## Rules
- ...
`;
}
```

3. Register it in `src/skills/registry.ts`:

```typescript
import * as mySkill from "./skills/my-skill/index.js";
export const SKILL_REGISTRY: SkillModule[] = [
  // ...
  mySkill,
];
```

The orchestrator automatically includes or skips it based on detected language/framework/patterns.

### Skill prompt format contract (must keep)

To preserve track parsing and coverage reporting, each skill prompt must keep this structure:

- `## What to check`
- Heading lines in `### <Letter>. <Title>` format (for example, `### A. Boundary Safety`)
- Numbered checks under each heading (`1.`, `2.`, ...)
- `## Rules`

If this format changes, update parser logic in `src/prompt/assemble.ts` and related tests.

## Config file

Lives at `~/.pr-review-mcp/config.json`. You can edit it directly:

```json
{
  "version": 1,
  "projects": {
    "notification-handler": {
      "repoUrl": "https://github.com/org/notification-handler",
      "mainBranch": "main"
    },
    "payments-service": {
      "repoUrl": "https://github.com/org/payments-service",
      "mainBranch": "develop"
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
    "temperature": 0
  }
}
```

`reviewRuntime` stores non-secret execution settings only. Keep API keys in environment variables (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`).

## Logging and debugging

The server writes structured logs to help trace what is happening at every step. Three output sinks are available:

| Sink | When active | Purpose |
|---|---|---|
| **stderr** | Always | Universal fallback. Visible in terminal, captured by process managers, shown in IDE MCP server logs. |
| **MCP notifications** | After transport connects | Structured log messages sent to the client via the MCP protocol. IDEs that support the logging capability display these in their UI. |
| **File** | Opt-in | Appends to a log file for post-mortem debugging. Off by default. |

### Log levels

| Level | What you see |
|---|---|
| `error` | Step failures with full context: the git command that failed, its stderr output, config state. Always shown. |
| `warn` | Recoverable issues: file content read fallbacks, numstat failures, fuzzy branch match attempts. |
| `info` (default) | Progress indicators: each pipeline step with timing, detection summaries, selected/skipped skills, assembly coverage counts, prompt-size telemetry, and execution telemetry (provider/model/attempts/latency/token usage when available). |
| `debug` | Everything above plus raw git commands and output, per-file processing, detection scoring, per-skill filter reasoning, and contract detail previews. |

### Configuration

Three sources control the log level and file sink, applied in precedence order (first match wins):

| Source | Log level | Log file |
|---|---|---|
| CLI argument | `--log-level=debug` | `--log-file` (default path) or `--log-file=/custom/path.log` |
| Environment variable | `PR_REVIEW_LOG=debug` | -- |
| Config file | `"logLevel": "debug"` | `"logFile": true` (default path) or `"logFile": "/custom/path.log"` |
| Default | `info` | off |

The default log file path is `~/.pr-review-mcp/debug.log`.

### Enabling debug mode

**In Cursor** -- add args or env to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "pr-review": {
      "command": "node",
      "args": ["/path/to/pr-review-mcp/dist/index.js", "--log-level=debug", "--log-file"]
    }
  }
}
```

**In Claude Code** -- add env to your MCP config:

```json
{
  "mcpServers": {
    "pr-review": {
      "command": "node",
      "args": ["/path/to/pr-review-mcp/dist/index.js"],
      "env": {
        "PR_REVIEW_LOG": "debug"
      }
    }
  }
}
```

**Via config file** -- edit `~/.pr-review-mcp/config.json`:

```json
{
  "logLevel": "debug",
  "logFile": true
}
```

### Example output

At `info` level, a typical review run produces:

```
[2025-03-23T10:15:30.100Z] [INFO] aggrowal-pr-review-mcp v0.1.0 started
[2025-03-23T10:15:31.200Z] [INFO] pr_review: starting
[2025-03-23T10:15:31.250Z] [INFO] T1: Project guard [48ms]
[2025-03-23T10:15:31.300Z] [INFO] T2: Branch resolver [45ms]
[2025-03-23T10:15:31.800Z] [INFO] T3: Diff extractor [498ms]
[2025-03-23T10:15:31.810Z] [INFO] Detected: language=typescript, frameworks=[react], patterns=[rest-api, auth]
[2025-03-23T10:15:31.811Z] [INFO] Skills: 3 matched, 0 skipped
[2025-03-23T10:15:31.812Z] [INFO] Skills selected: correctness, security-generic, testing-quality
[2025-03-23T10:15:31.820Z] [INFO] Orchestrator: detect + filter [18ms]
[2025-03-23T10:15:31.821Z] [INFO] Assembly coverage contract: tracks=3, headings=18, subpoints=60
[2025-03-23T10:15:31.821Z] [INFO] Assembly prompt size: total=48312, static=4121, payload=38320, tracks=9871
[2025-03-23T10:15:31.821Z] [INFO] Assembly [1ms]
[2025-03-23T10:15:32.700Z] [INFO] Execution: complete
[2025-03-23T10:15:31.822Z] [INFO] pr_review: complete
```

At `debug` level, each step additionally logs git commands, raw output, detection scoring, per-skill filter reasoning, and coverage-contract previews.

## Skill registry

| Skill | Runs on | Checks for |
|---|---|---|
| `correctness` | all languages | contract/invariant correctness, data integrity, failure semantics, async ordering, idempotency/time behavior, boundary/unit safety, API shape correctness, and cleanup/invalidation correctness. |
| `security-generic` | all languages | 36-point security checklist across secrets/data exposure, auth/authz, injection classes, SSRF/path handling, crypto, deserialization, resilience-related security failures, and config/supply chain risks. |
| `redundancy` | all languages | deep redundancy checks: duplicate logic, dead/unreachable code, import/dependency redundancy, redundant computation/data movement, speculative abstraction, reinvented utilities, and debug/review noise. |
| `performance-scalability` | all languages | complexity hotspots, N+1 and IO amplification, allocation pressure, blocking work in hot paths, and unbounded growth/capacity risks. |
| `reliability-resilience` | all languages | timeout/cancellation propagation, retry/backoff correctness, idempotency under retries/replays, graceful degradation, and failure containment/recovery safety. |
| `api-contract-compatibility` | all languages | API compatibility and protocol semantics: backward-compat behavior, versioning/deprecation safety, HTTP method/status correctness, and stable machine-readable error contracts. |
| `testing-quality` | all languages | missing test coverage for changed behavior, edge/negative/concurrency testing gaps, flaky test risks, and assertion quality. |
| `observability-operability` | all languages | golden signal coverage, structured/correlated telemetry, alert actionability, rollout operability, and production-debug readiness. |
| `maintainability-design` | all languages | module boundaries, coupling/cohesion quality, cognitive complexity control, and long-term maintainability design risks. |
| `accessibility-i18n` | projects with `frontend-ui` pattern | keyboard/focus semantics, assistive labeling and structure, interaction inclusivity, and localization/globalization readiness. |

## Development

```bash
npm run build     # compile TypeScript
npm run dev       # watch mode
npm test          # run test suite
npm start         # start the MCP server
```

## Architecture

The server is hybrid deterministic + model execution. It gathers context via local git commands, detects the project stack through heuristics, filters relevant skills, assembles a structured prompt, and then executes a provider-backed model call. The model response is parsed as JSON, validated against schema + track coverage contract, and returned to the client as machine-readable output.

This design sends changed-file payload once for all tracks, reducing redundant prompt tokens as track count grows, while preserving enough structure for consistent per-track coverage validation.

### Prompt-injection hardening

Diff content is untrusted -- a malicious PR could contain text designed to override review instructions. The assembled prompt mitigates this with:

- **Untrusted-content sentinels** (`<<<UNTRUSTED_DIFF_BEGIN>>>` / `<<<UNTRUSTED_DIFF_END>>>`) wrapping diff and file payloads inside the shared changed-files section.
- **Sentinel-collision escaping** so diff content cannot break out of the untrusted region.
- **Explicit trust boundary preamble** instructing the model to ignore any instructions, role changes, or "ignore previous" directives appearing inside untrusted regions.
- **Path sanitization** stripping control characters from file paths before interpolating them into the prompt structure.
- **Trusted reviewer focus channel** via `pr_review.reviewInstructions`, which is added in the trusted prompt section (never sourced from diff content).

## Future change checklist

When modifying prompt assembly, skills, or reporting behavior, keep these invariants:

1. **Coverage contract integrity**
   - Every matched track should appear in `Track execution contract`.
   - Final JSON instructions must require per-track/per-heading status and failure reasoning.
   - Runtime validator must reject missing/extra track/heading/sub-point coverage.
2. **Skill parseability**
   - Skills must keep `### Letter. Heading` + numbered checks for parser compatibility.
3. **Token discipline**
   - Prefer concise wording and dedupe over dropping context.
   - Re-check prompt-size telemetry after major prompt changes.
4. **Safety boundary integrity**
   - Preserve trusted/untrusted sentinel model and path sanitization.
5. **Verification**
   - Run `npm test` and `npm run build`.
   - Ensure contract-related tests pass (`assembled-prompt`, `skills-contract`, `prompt-assembly`, `review-contract-schema`, `review-execution`, `pr-review-tool-json`).
