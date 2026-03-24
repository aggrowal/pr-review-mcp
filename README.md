# pr-review-mcp

A configurable MCP server for intelligent, multi-track PR reviews. Plugs into Claude Code, Cursor, Windsurf, or any MCP-compatible IDE.

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
Assembled prompt        context + shared changed-file payload + matched tracks
  |
Final report            verdict + per-track coverage + heading-level statuses
```

## Review contract enforcement

The server now assembles an explicit execution contract for matched tracks so the final report can cover every heading/sub-point consistently.

- **Track execution contract (server-generated):** For each `## TRACK`, the assembler extracts:
  - heading ids/titles from `### A. Heading`
  - numbered sub-points from `1.`, `2.`, ...
  - compact sub-point ranges for report guidance
- **Required final report coverage:** The output contract requires a `Track Coverage` section with:
  - each executed track
  - per-heading status (`blocker | needs_improvement | nudge | looks_good`)
  - passed/failed sub-point ids
  - reason when any sub-point fails
  - explicit `"all pointers are positive"` when no sub-point fails
- **Output-side compliance marker:** The final report instructions require:
  - `CONTRACT_COMPLIANCE: PASS | FAIL`
  - if `FAIL`, `CONTRACT_GAPS` and `CONTRACT_REASON` must identify missing track/heading/sub-point coverage
- **Verdict guidance:** Statuses map to `APPROVE` / `NEEDS_DISCUSSION` / `REQUEST_CHANGES` rules in the final report instructions.

Important architecture note: this MCP server does not receive the model's generated report back. Enforcement is therefore prompt-contract driven, with server logs providing expected-execution telemetry.

### Interpreting omissions

If a review output omits any `[run]` track, heading, or required sub-point accounting, treat it as contract non-compliance.
Root cause is usually model-side instruction following drift, not prompt assembly failure: the server currently assembles and logs the contract but does not post-validate the model's returned report.

## Token efficiency strategy

Token reduction is applied without dropping review context:

- **Single-call flow:** Keep one `pr_review` call; avoid extra validation/tool round-trips.
- **Shared payload once:** Changed files payload is injected once and shared across all tracks.
- **Track prompt compaction:** Repeated per-track intro boilerplate is removed at assembly time; checklists and rules remain intact.
- **Lossless payload dedupe:** For `added` files, avoid duplicating `Full file` when diff already contains full content.
- **Concise instruction language:** Server-side guidance is written in short, direct language to reduce token overhead.
- **Prompt telemetry:** Assembly logs emit `static`, `payload`, `tracks`, and `total` char counts.

## Setup

### 1. Install

```bash
cd pr-review-mcp
npm install
npm run build
```

### 2. Register with your IDE

**Claude Code** -- add to `~/.config/claude-code/mcp.json` (or project `.mcp.json`):

```json
{
  "mcpServers": {
    "pr-review": {
      "command": "node",
      "args": ["/absolute/path/to/pr-review-mcp/dist/index.js"]
    }
  }
}
```

**Cursor** -- add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "pr-review": {
      "command": "node",
      "args": ["/absolute/path/to/pr-review-mcp/dist/index.js"]
    }
  }
}
```

### 3. Configure a project (one-time per project)

From inside the IDE, call the tool:

```
configure_project
  name: notification-handler
  repoUrl: https://github.com/org/notification-handler
  mainBranch: main
```

This writes to `~/.pr-review-mcp/config.json`. Do this once; it persists.
Update anytime by calling `configure_project` again with the same name.

### 4. Run a review

Branch name is always required -- no defaulting to current branch, to prevent accidental reviews.

```
@pr_review branch: feature/login
@pr_review branch: fix/JIRA-1234-payment-null-check
@pr_review branch: java21-upgrade reviewInstructions: Focus on upgrade regressions, test execution coverage, and config compatibility.
```

`reviewInstructions` is an optional trusted channel for reviewer focus.
Use it to add priorities, but required track execution and final report contract rules still apply.
Keep it concise (max 2000 characters).

### 5. Troubleshooting prompt changes

If prompt behavior does not reflect recent code changes:

1. Rebuild the server:

```bash
npm run build
```

2. Restart the MCP server process from your IDE so it reloads `dist/index.js`.
3. Re-run `@pr_review` and confirm updated sections are present in the returned prompt.

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
  "logFile": true
}
```

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
| `info` (default) | Progress indicators: each pipeline step with timing, detection summaries, selected/skipped skills, assembly coverage counts, and prompt-size telemetry. |
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
[2025-03-23T10:15:30.100Z] [INFO] pr-review-mcp v0.1.0 started
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

The server is purely deterministic -- it makes zero model calls. It gathers context via local git commands, detects the project stack through heuristics, filters relevant skills, and assembles a single structured prompt. The assembled prompt includes one shared changed-file payload section, checklist-focused skill tracks, a generated track execution contract, and explicit final-report requirements.

This design sends changed-file payload once for all tracks, reducing redundant prompt tokens as track count grows, while preserving enough structure for consistent per-track reporting.

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
   - Final report instructions must require per-track/per-heading status and failure reasoning.
2. **Skill parseability**
   - Skills must keep `### Letter. Heading` + numbered checks for parser compatibility.
3. **Token discipline**
   - Prefer concise wording and dedupe over dropping context.
   - Re-check prompt-size telemetry after major prompt changes.
4. **Safety boundary integrity**
   - Preserve trusted/untrusted sentinel model and path sanitization.
5. **Verification**
   - Run `npm test` and `npm run build`.
   - Ensure prompt-related tests pass (`assembled-prompt`, `skills-contract`, `prompt-assembly`).
