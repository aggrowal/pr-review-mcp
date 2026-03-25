# Platform Setup Guide

This guide covers how to configure `aggrowal-pr-review-mcp` on each supported MCP host platform.

## Runtime model

This server is keyless and host-driven:

- Server performs deterministic PR preprocessing and strict validation.
- Host chat model generates draft review JSON.
- Server validates draft against schema + per-track contract.
- On failures, server returns repair instructions until valid or attempts are exhausted.

No Anthropic/OpenAI API keys are required for normal operation.

---

## Cursor

### Configuration

Create or edit `.cursor/mcp.json` in your project root (or your global Cursor config):

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

### Usage

In the Cursor chat, type:

```
@pr_review branch: feature/my-branch
```

Cursor should then continue through staged `prepare` -> `validate` (and optional `repair`) until `final`.
Progress logs appear in MCP logs.

---

## Claude Code (claude CLI)

Claude Code supports MCP servers via the `claude mcp add` command or by editing `.claude/mcp_servers.json`.

### Configuration (CLI)

```bash
claude mcp add pr-review -- npx -y aggrowal-pr-review-mcp
```

### Configuration (JSON)

Create or edit `.claude/mcp_servers.json` in your home directory:

```json
{
  "pr-review": {
    "command": "npx",
    "args": ["-y", "aggrowal-pr-review-mcp"],
    "env": {}
  }
}
```

### Usage

In a Claude Code session:

```
use pr_review with branch: feature/my-branch
```

If your Claude Code setup does not auto-chain staged calls, run follow-up validate call manually with `sessionId` + `draftReport`.

---

## Windsurf

Windsurf supports MCP servers via its configuration file.

### Configuration

Add to your Windsurf MCP configuration (typically `~/.windsurf/mcp.json` or project-level):

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

---

## Antigravity

Antigravity uses MCP stdio configuration through its MCP settings.
Use the same command/args:

```json
{
  "pr-review": {
    "command": "npx",
    "args": ["-y", "aggrowal-pr-review-mcp"],
    "env": {}
  }
}
```

---

## Generic MCP client

For any MCP client with tools support:

1. Configure server command as `npx -y aggrowal-pr-review-mcp`.
2. Run `pr_review branch: <branch-name>`.
3. Consume stage payloads:
   - `prepare` => generate draft from returned prompt
   - `validate` => send draft back
   - `repair` => regenerate and resubmit
   - `final` => validated result

Manual validate call format:

```text
pr_review sessionId: <session-id> draftReport: <json-report>
```

---

## Environment Variables Reference

| Variable | Purpose | Default |
|----------|---------|---------|
| `PR_REVIEW_LOG` | Log level (`debug`, `info`, `warn`, `error`) | `info` |

---

## First-Time Project Setup

Before your first review, either:

**Option A: Auto-detection (recommended)**
Just run `@pr_review branch: feature/xyz` from inside your repo. The server auto-detects the project from `git remote`.

**Option B: Explicit configuration**
```
configure_project
  name: my-repo
  repoUrl: https://github.com/org/my-repo
  mainBranch: main
```

The project config is stored at `~/.pr-review-mcp/config.json` and persists across sessions.
