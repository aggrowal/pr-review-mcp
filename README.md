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
Assembled prompt        context + matched skill tracks sent to model
  |
Final report            APPROVE / REQUEST_CHANGES / NEEDS_DISCUSSION + findings
```

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
```

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

export function buildPrompt(diff: DiffContext, ctx: DetectedContext): string {
  const fileDiffs = diff.files
    .filter((f) => f.status !== "deleted")
    .map((f) => `### ${f.path}\n\`\`\`\n${f.diff}\n\`\`\``)
    .join("\n\n");

  return `Review this diff for [your concern]...\n\n${fileDiffs}`;
}
```

3. Register it in `src/index.ts`:

```typescript
import * as mySkill from "./skills/my-skill/index.js";
const SKILL_REGISTRY: SkillModule[] = [correctness, securityGeneric, redundancy, mySkill];
```

The orchestrator automatically includes or skips it based on detected language/framework/patterns.

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
| `info` (default) | Progress indicators: each pipeline step with timing, detection summaries, skill matching counts, assembly stats. Tells you the session is moving and what it did. |
| `debug` | Everything above plus raw git commands and output, per-file processing, detection scoring, skill filter reasoning per skill, full input and output of each function. |

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
[2025-03-23T10:15:31.820Z] [INFO] Orchestrator: detect + filter [18ms]
[2025-03-23T10:15:31.821Z] [INFO] Assembly [1ms]
[2025-03-23T10:15:31.822Z] [INFO] pr_review: complete
```

At `debug` level, each step additionally logs git commands, raw output, detection scoring, and per-skill filter reasoning.

## Skill registry

| Skill | Runs on | Checks for |
|---|---|---|
| `correctness` | all languages | logic errors, edge cases, error handling, async correctness |
| `security-generic` | all languages | secrets, injection, auth, insecure defaults, weak crypto |
| `redundancy` | all languages | duplication, dead code, unused imports, over-engineering |

## Development

```bash
npm run build     # compile TypeScript
npm run dev       # watch mode
npm test          # run test suite
npm start         # start the MCP server
```

## Architecture

The server is purely deterministic -- it makes zero model calls. It gathers context via local git commands, detects the project stack through heuristics, filters relevant skills, and assembles a single structured prompt. The IDE's model executes the skill tracks and produces the final report.

This design sends the diff context exactly once to the model, minimizing token usage.
