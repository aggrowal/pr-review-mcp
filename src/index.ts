#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  upsertProjectConfig,
  readConfig,
  configFilePath,
} from "./config.js";
import { runProjectGuard } from "./tools/t1-project-guard.js";
import { runBranchResolver } from "./tools/t2-branch-resolver.js";
import { runDiffExtractor } from "./tools/t3-diff-extractor.js";
import { detectProjectContext, filterSkills } from "./orchestrator/detect.js";
import {
  Logger,
  parseCliArgs,
  resolveLogConfig,
} from "./logger.js";

import type { DiffContext, DetectedContext, SkillMetadata, SkillModule } from "./types.js";

// ---- Skill registry ----

import * as correctness from "./skills/correctness/index.js";
import * as securityGeneric from "./skills/security-generic/index.js";
import * as redundancy from "./skills/redundancy/index.js";

const SKILL_REGISTRY: SkillModule[] = [correctness, securityGeneric, redundancy];

// ---- Logger initialization ----

const cliArgs = parseCliArgs(process.argv);
const config = readConfig();
const logConfig = resolveLogConfig({
  cliLogLevel: cliArgs.logLevel,
  cliLogFile: cliArgs.logFile,
  envLogLevel: process.env.PR_REVIEW_LOG,
  configLogLevel: config.logLevel,
  configLogFile: config.logFile,
});
const logger = new Logger(logConfig);

// ---- Server ----

const server = new McpServer(
  { name: "pr-review-mcp", version: "0.1.0" },
  { capabilities: { logging: {} } },
);

// ---- Tool: configure_project ----

server.tool(
  "configure_project",
  "Register or update a project in the PR review config. Run this once per project.",
  {
    name: z
      .string()
      .min(1)
      .describe(
        "Project name -- must match the git repo folder name exactly (case-sensitive)"
      ),
    repoUrl: z
      .string()
      .url()
      .describe(
        "Full git repository URL, e.g. https://github.com/org/notification-handler"
      ),
    mainBranch: z
      .string()
      .default("main")
      .describe(
        "Name of the main/base branch to compare against. Defaults to 'main'."
      ),
  },
  async ({ name, repoUrl, mainBranch }) => {
    logger.info(`configure_project: saving project "${name}"`, { repoUrl, mainBranch });
    upsertProjectConfig(name, { repoUrl, mainBranch });
    logger.info(`configure_project: project "${name}" saved`, { configFile: configFilePath() });

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Project "${name}" configured.`,
            `  Repo URL   : ${repoUrl}`,
            `  Main branch: ${mainBranch}`,
            `  Config file: ${configFilePath()}`,
            ``,
            `You can now run @pr_review from inside the "${name}" repository.`,
          ].join("\n"),
        },
      ],
    };
  }
);

// ---- Tool: list_projects ----

server.tool(
  "list_projects",
  "List all configured projects.",
  {},
  async () => {
    logger.info("list_projects: reading config");
    const cfg = readConfig();
    const entries = Object.entries(cfg.projects);
    logger.info(`list_projects: ${entries.length} project(s) found`);

    if (entries.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No projects configured yet. Use configure_project to add one.",
          },
        ],
      };
    }

    const lines = entries.map(
      ([name, p]) => `  - ${name}  ->  ${p.repoUrl}  (base: ${p.mainBranch})`
    );

    return {
      content: [
        {
          type: "text" as const,
          text: `Configured projects:\n${lines.join("\n")}`,
        },
      ],
    };
  }
);

// ---- Prompt: @pr_review ----

server.prompt(
  "pr_review",
  "Run a full PR review on a specified branch. " +
    "Usage: @pr_review branch: feature/my-branch",
  {
    branch: z
      .string()
      .optional()
      .describe("Branch to review. Must be specified explicitly."),
    cwd: z
      .string()
      .optional()
      .describe(
        "Working directory to run from. Defaults to process.cwd(). " +
          "Most IDEs inject this automatically."
      ),
  },
  async ({ branch, cwd: cwdArg }) => {
    const cwd = cwdArg ?? process.cwd();
    logger.info(`pr_review: starting`, { branch, cwd });

    // T1: Project guard
    const endT1 = logger.startStep("T1: Project guard");
    const guard = runProjectGuard(cwd, logger);
    if (!guard.ok) {
      logger.error(`T1: Project guard failed -- ${guard.reason}`, { hint: guard.hint, detail: guard.detail });
      endT1({ status: "failed" });
      const detail = guard.detail ? `\n\nDetail: ${guard.detail}` : "";
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `PR Review blocked\n\nReason: ${guard.reason}\n\nWhat to do: ${guard.hint}${detail}`,
            },
          },
        ],
      };
    }
    endT1({ project: guard.projectName, mainBranch: guard.mainBranch });

    // T2: Branch resolver
    const endT2 = logger.startStep("T2: Branch resolver");
    const branchResult = runBranchResolver(guard, branch, logger);
    if (!branchResult.ok) {
      logger.error(`T2: Branch resolver failed -- ${branchResult.reason}`, { hint: branchResult.hint, detail: branchResult.detail });
      endT2({ status: "failed" });
      const detail = branchResult.detail ? `\n\nDetail: ${branchResult.detail}` : "";
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Branch resolution failed\n\nReason: ${branchResult.reason}\n\nWhat to do: ${branchResult.hint}${detail}`,
            },
          },
        ],
      };
    }
    endT2({ head: branchResult.context.headBranch, base: branchResult.context.baseBranch });

    // T3: Diff extractor
    const endT3 = logger.startStep("T3: Diff extractor");
    const diffResult = runDiffExtractor(branchResult.context, logger);
    if (!diffResult.ok) {
      logger.error(`T3: Diff extractor failed -- ${diffResult.reason}`, { hint: diffResult.hint, detail: diffResult.detail });
      endT3({ status: "failed" });
      const detail = diffResult.detail ? `\n\nDetail: ${diffResult.detail}` : "";
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Diff extraction failed\n\nReason: ${diffResult.reason}\n\nWhat to do: ${diffResult.hint}${detail}`,
            },
          },
        ],
      };
    }
    endT3({ files: diffResult.diff.files.length, additions: diffResult.diff.totalAdditions, deletions: diffResult.diff.totalDeletions });

    const diff = diffResult.diff;

    // Orchestrator: detect context, filter skills
    const endDetect = logger.startStep("Orchestrator: detect + filter");
    const detectedCtx = detectProjectContext(diff, logger);
    const { matched, skipped } = filterSkills(
      detectedCtx,
      SKILL_REGISTRY.map((s) => s.metadata),
      logger
    );
    endDetect({ language: detectedCtx.language, frameworks: detectedCtx.framework, patterns: detectedCtx.patterns, matched: matched.length, skipped: skipped.length });

    // Assembly
    const endAssembly = logger.startStep("Assembly");
    const assembledPrompt = buildAssembledPrompt(
      diff,
      detectedCtx,
      matched,
      skipped
    );
    endAssembly({ skills: matched.length, promptChars: assembledPrompt.length });

    logger.info("pr_review: complete");

    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: assembledPrompt,
          },
        },
      ],
    };
  }
);

// ---- Assembled prompt builder ----

function buildAssembledPrompt(
  diff: DiffContext,
  ctx: DetectedContext,
  matchedSkillMeta: SkillMetadata[],
  skippedSkillMeta: { skill: SkillMetadata; reason: string }[]
): string {
  const skillSections = SKILL_REGISTRY.filter((s) =>
    matchedSkillMeta.some((m) => m.id === s.metadata.id)
  )
    .map((s) => {
      const prompt = s.buildPrompt(diff, ctx);
      return `## TRACK: ${s.metadata.id}\n\n${prompt}`;
    })
    .join("\n\n---\n\n");

  const fileList = diff.files
    .map(
      (f) => `  - ${f.path} (${f.status}, +${f.additions}/-${f.deletions})`
    )
    .join("\n");

  const matchedList = matchedSkillMeta
    .map((s) => `  [run] ${s.id} -- ${s.description}`)
    .join("\n");

  const skippedList =
    skippedSkillMeta.length > 0
      ? "\n" +
        skippedSkillMeta
          .map((s) => `  [skip] ${s.skill.id} -- ${s.reason}`)
          .join("\n")
      : "";

  return `You are performing a PR review. Execute each TRACK below.

## Review context
- Project: ${diff.projectName}
- Repo: ${diff.repoUrl}
- Branch: ${diff.headBranch} -> ${diff.baseBranch}
- Language: ${ctx.language}
- Frameworks: ${ctx.framework.join(", ") || "none"}
- Patterns: ${ctx.patterns.join(", ") || "none"}
- Files changed (${diff.files.length}):
${fileList}
- Total: +${diff.totalAdditions} / -${diff.totalDeletions}

## Skills
${matchedList}${skippedList}

## Execution instructions
If your environment supports parallel sub-agents or concurrent tool calls,
execute each TRACK simultaneously. Otherwise execute them sequentially.
Collect ALL findings before writing the final report.

---

${skillSections}

---

## Final report instructions
After all tracks complete, synthesize a single report using this structure:

### PR Review: ${diff.projectName}
**Branch:** \`${diff.headBranch}\` -> \`${diff.baseBranch}\`
**Stack:** ${ctx.language}${ctx.framework.length ? " / " + ctx.framework.join(", ") : ""}
**Verdict:** APPROVE | REQUEST_CHANGES | NEEDS_DISCUSSION

Verdict rules:
- Any critical or high severity finding -> REQUEST_CHANGES
- Any medium finding with no critical/high -> NEEDS_DISCUSSION
- All findings low/info or positive only -> APPROVE

#### Strengths
(list positive findings from all tracks)

#### Issues
For each improvement finding, grouped by severity (critical -> high -> medium -> low):
- **[SEVERITY] Track: filename:lines** -- summary
  - Detail: explanation
  - Fix: concrete suggestion

#### Summary
One paragraph overall assessment.`;
}

// ---- Start ----

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.setMcpServer(server);
  logger.info("pr-review-mcp v0.1.0 started", {
    level: logConfig.level,
    filePath: logConfig.filePath ?? "none",
    sinks: ["stderr", "mcp", ...(logConfig.filePath ? ["file"] : [])],
  });
}

main().catch((err) => {
  logger.error("Fatal error during startup", { error: String(err) });
  process.exit(1);
});
