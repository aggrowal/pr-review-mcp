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
import { applyTokenBudget } from "./budget/index.js";
import { detectProjectContext, filterSkills } from "./orchestrator/detect.js";
import {
  Logger,
  parseCliArgs,
  resolveLogConfig,
} from "./logger.js";
import { SKILL_REGISTRY } from "./skills/registry.js";
import { buildAssembledPromptWithTelemetry } from "./prompt/assemble.js";
import {
  buildPrReviewFinalJson,
  buildPrReviewErrorJsonFromFields,
  buildPrReviewPrepareJson,
  buildPrReviewRepairJson,
} from "./review/tool-result.js";
import { formatReviewAsMarkdown } from "./review/format-markdown.js";
import { buildRepairPrompt, validateReviewDraft } from "./review/validate-report.js";
import { ReviewSessionStore, isoTimestamp } from "./review/session-store.js";
import { getServerVersion } from "./version.js";

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
const serverVersion = getServerVersion();

// ---- Server ----

const server = new McpServer(
  { name: "aggrowal-pr-review-mcp", version: serverVersion },
  { capabilities: { logging: {} } },
);
const sessionStore = new ReviewSessionStore();

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

// ---- Tool: pr_review ----

server.tool(
  "pr_review",
  "Run staged keyless PR review. Host must chain prepare -> validate/repair using nextAction.callTemplate.",
  {
    branch: z
      .string()
      .optional()
      .describe(
        "Prepare stage: branch to review. Must be specified explicitly."
      ),
    cwd: z
      .string()
      .optional()
      .describe(
        "Prepare stage: working directory. Defaults to process.cwd(). Most IDEs inject this automatically."
      ),
    reviewInstructions: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .describe(
        "Prepare stage: trusted reviewer focus to include in prompt assembly (max 2000 chars)."
      ),
    format: z
      .enum(["json", "markdown"])
      .optional()
      .describe(
        "Requested final output format when validation reaches final stage."
      ),
    sessionId: z
      .string()
      .optional()
      .describe(
        "Validate stage: session ID returned by prepare/repair. Required together with draftReport."
      ),
    draftReport: z
      .unknown()
      .optional()
      .describe(
        "Validate stage: draft JSON report from host model (object or JSON string). Required together with sessionId."
      ),
    model: z
      .string()
      .optional()
      .describe("Validate stage: optional host model identifier used for draft generation."),
  },
  async ({
    branch,
    cwd: cwdArg,
    reviewInstructions,
    format,
    sessionId,
    draftReport,
    model,
  }) => {
    if (sessionId || draftReport !== undefined) {
      return handleValidateStage({
        sessionId,
        draftReport,
        format,
        model,
      });
    }

    return handlePrepareStage({
      branch,
      cwd: cwdArg,
      reviewInstructions,
      format,
    });
  }
);

interface PrepareStageInput {
  branch?: string;
  cwd?: string;
  reviewInstructions?: string;
  format?: "json" | "markdown";
}

interface ValidateStageInput {
  sessionId?: string;
  draftReport?: unknown;
  format?: "json" | "markdown";
  model?: string;
}

async function handlePrepareStage(input: PrepareStageInput) {
  const cwd = input.cwd ?? process.cwd();
  const trustedReviewInstructions =
    input.reviewInstructions && input.reviewInstructions.length > 0
      ? input.reviewInstructions
      : undefined;
  const outputFormat = input.format ?? "json";

  logger.info("pr_review: prepare stage starting", { branch: input.branch, cwd });

  // T1: Project guard
  const endT1 = logger.startStep("T1: Project guard");
  const guard = runProjectGuard(cwd, logger);
  if (!guard.ok) {
    logger.error(`T1: Project guard failed -- ${guard.reason}`, {
      hint: guard.hint,
      detail: guard.detail,
    });
    endT1({ status: "failed" });
    return makeToolError(
      "project_guard_failed",
      guard.reason,
      [guard.hint, guard.detail].filter(Boolean).join("\n\n")
    );
  }
  endT1({ project: guard.projectName, mainBranch: guard.mainBranch });

  // T2: Branch resolver
  const endT2 = logger.startStep("T2: Branch resolver");
  const branchResult = runBranchResolver(guard, input.branch, logger);
  if (!branchResult.ok) {
    logger.error(`T2: Branch resolver failed -- ${branchResult.reason}`, {
      hint: branchResult.hint,
      detail: branchResult.detail,
    });
    endT2({ status: "failed" });
    return makeToolError(
      "branch_resolution_failed",
      branchResult.reason,
      [branchResult.hint, branchResult.detail].filter(Boolean).join("\n\n")
    );
  }
  endT2({
    head: branchResult.context.headBranch,
    base: branchResult.context.baseBranch,
  });

  // T3: Diff extractor
  const endT3 = logger.startStep("T3: Diff extractor");
  const diffResult = runDiffExtractor(branchResult.context, logger, {
    enrichment: config.reviewRuntime.enrichment,
  });
  if (!diffResult.ok) {
    logger.error(`T3: Diff extractor failed -- ${diffResult.reason}`, {
      hint: diffResult.hint,
      detail: diffResult.detail,
    });
    endT3({ status: "failed" });
    return makeToolError(
      "diff_extraction_failed",
      diffResult.reason,
      [diffResult.hint, diffResult.detail].filter(Boolean).join("\n\n")
    );
  }
  endT3({
    files: diffResult.diff.files.length,
    additions: diffResult.diff.totalAdditions,
    deletions: diffResult.diff.totalDeletions,
  });

  // Budget check: enforce file/line limits, estimate token budget
  const endBudget = logger.startStep("Budget check");
  const budgetResult = applyTokenBudget(
    diffResult.diff,
    SKILL_REGISTRY.length,
    config.reviewRuntime.tokenBudget,
    logger
  );
  if (!budgetResult.ok) {
    logger.error(`Budget check failed -- ${budgetResult.reason}`, {
      hint: budgetResult.hint,
    });
    endBudget({ status: "failed" });
    return makeToolError(
      "budget_exceeded",
      budgetResult.reason,
      budgetResult.hint
    );
  }
  if (budgetResult.truncated) {
    logger.warn("Budget: payload was truncated to fit token budget", {
      droppedFiles: budgetResult.droppedFiles.length,
      droppedFullContent: budgetResult.droppedFullContent.length,
      truncatedDiffs: budgetResult.truncatedDiffs.length,
    });
  }
  endBudget({
    truncated: budgetResult.truncated,
    files: budgetResult.diff.files.length,
  });

  const diff = budgetResult.diff;

  // Orchestrator: detect context, filter skills
  const endDetect = logger.startStep("Orchestrator: detect + filter");
  const detectedCtx = detectProjectContext(diff, logger);
  const { matched, skipped } = filterSkills(
    detectedCtx,
    SKILL_REGISTRY.map((s) => s.metadata),
    logger
  );
  logger.info(
    `Skills selected: ${matched.map((skill) => skill.id).join(", ") || "none"}`
  );
  if (skipped.length > 0) {
    logger.info(
      `Skills skipped: ${skipped
        .map((entry) => `${entry.skill.id} (${entry.reason})`)
        .join("; ")}`
    );
  }
  endDetect({
    language: detectedCtx.language,
    frameworks: detectedCtx.framework,
    patterns: detectedCtx.patterns,
    matched: matched.length,
    skipped: skipped.length,
  });

  // Assembly
  const endAssembly = logger.startStep("Assembly");
  const assembled = buildAssembledPromptWithTelemetry(
    diff,
    detectedCtx,
    matched,
    skipped,
    { reviewInstructions: trustedReviewInstructions }
  );
  const telemetry = assembled.telemetry;
  const contractPreview = assembled.trackContracts
    .map((track) =>
      `${track.trackId}[${track.headings
        .map((heading) => `${heading.id}:${heading.subpoints.length}`)
        .join(",")}]`
    )
    .join(" | ");

  logger.info(
    `Assembly coverage contract: tracks=${telemetry.matchedTrackCount}, headings=${telemetry.headingCount}, subpoints=${telemetry.subpointCount}`
  );
  logger.info(
    `Assembly prompt size: total=${telemetry.totalChars}, static=${telemetry.staticChars}, payload=${telemetry.payloadChars}, tracks=${telemetry.trackChars}`
  );
  logger.debug("Assembly contract details", { contract: contractPreview });

  endAssembly({
    skills: matched.length,
    promptChars: telemetry.totalChars,
    staticChars: telemetry.staticChars,
    payloadChars: telemetry.payloadChars,
    trackChars: telemetry.trackChars,
    headings: telemetry.headingCount,
    subpoints: telemetry.subpointCount,
  });

  const session = sessionStore.createSession({
    assembledPrompt: assembled.prompt,
    trackContracts: assembled.trackContracts,
    ttlMinutes: config.reviewRuntime.sessionTtlMinutes,
    maxAttempts: config.reviewRuntime.maxValidationAttempts,
    outputFormat,
  });

  logger.info("pr_review: prepare stage complete", {
    sessionId: session.sessionId,
    maxAttempts: session.maxAttempts,
    expiresAt: isoTimestamp(session.expiresAtMs),
    format: session.outputFormat,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: buildPrReviewPrepareJson({
          sessionId: session.sessionId,
          attempt: session.attempt,
          maxAttempts: session.maxAttempts,
          expiresAt: isoTimestamp(session.expiresAtMs),
          prompt: session.assembledPrompt,
          trackContracts: session.trackContracts,
        }),
      },
    ],
  };
}

async function handleValidateStage(input: ValidateStageInput) {
  logger.info("pr_review: validate stage starting", {
    sessionId: input.sessionId,
    hasDraftReport: input.draftReport !== undefined,
  });

  if (!input.sessionId || input.draftReport === undefined) {
    const missing: string[] = [];
    if (!input.sessionId) missing.push("sessionId");
    if (input.draftReport === undefined) missing.push("draftReport");

    return makeToolError(
      "validate_request_invalid",
      "Validate stage requires both sessionId and draftReport.",
      [
        `Missing field(s): ${missing.join(", ") || "unknown"}.`,
        "Call pr_review prepare stage first, then call pr_review again using the exact nextAction.callTemplate from prepare/repair output.",
        "Manual fallback template:",
        '{"sessionId":"<from_prepare_or_repair>","draftReport":"<generated_report_json_object_or_string>","format":"json","model":"<optional_host_model_identifier>"}',
      ].join("\n")
    );
  }

  const beginAttempt = sessionStore.beginValidationAttempt(input.sessionId);
  if (!beginAttempt.ok) {
    if (beginAttempt.reason === "missing") {
      return makeToolError(
        "session_not_found",
        `Session "${input.sessionId}" was not found.`,
        "Run pr_review prepare stage again to create a fresh session."
      );
    }
    if (beginAttempt.reason === "expired") {
      return makeToolError(
        "session_expired",
        `Session "${input.sessionId}" has expired.`,
        "Run pr_review prepare stage again to create a fresh session."
      );
    }
    return makeToolError(
      "validation_attempts_exhausted",
      `Session "${input.sessionId}" reached the maximum validation attempts.`,
      "Run pr_review prepare stage again to start a new validation loop."
    );
  }

  const session = beginAttempt.session;
  const validation = validateReviewDraft(input.draftReport, session.trackContracts);

  if (!validation.ok) {
    logger.warn("pr_review: validate stage failed", {
      sessionId: session.sessionId,
      attempt: session.attempt,
      issueCount: validation.issues.length,
    });

    if (session.attempt >= session.maxAttempts) {
      sessionStore.complete(session.sessionId);
      return makeToolError(
        "validation_attempts_exhausted",
        "Draft review remained invalid after maximum validation attempts.",
        validation.issues.join("\n")
      );
    }

    const correctionPrompt = [
      session.assembledPrompt,
      buildRepairPrompt(validation.issues),
    ].join("\n\n");

    return {
      content: [
        {
          type: "text" as const,
          text: buildPrReviewRepairJson({
            sessionId: session.sessionId,
            attempt: session.attempt,
            maxAttempts: session.maxAttempts,
            expiresAt: isoTimestamp(session.expiresAtMs),
            validationIssues: validation.issues,
            correctionPrompt,
          }),
        },
      ],
    };
  }

  const resolvedFormat = input.format ?? session.outputFormat;
  const resolvedModel = input.model?.trim() || undefined;
  const markdown =
    resolvedFormat === "markdown"
      ? formatReviewAsMarkdown({
          review: validation.report,
          provider: "host_model",
          model: resolvedModel ?? "unspecified",
          attempts: session.attempt,
        })
      : undefined;

  sessionStore.complete(session.sessionId);
  logger.info("pr_review: validate stage complete", {
    sessionId: session.sessionId,
    attempt: session.attempt,
    format: resolvedFormat,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: buildPrReviewFinalJson({
          review: validation.report,
          sessionId: session.sessionId,
          validationAttempts: session.attempt,
          model: resolvedModel,
          markdown,
        }),
      },
    ],
  };
}

function makeToolError(
  code: Parameters<typeof buildPrReviewErrorJsonFromFields>[0]["code"],
  message: string,
  detail?: string,
  retryable = false
) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: buildPrReviewErrorJsonFromFields({
          code,
          message,
          detail,
          retryable,
        }),
      },
    ],
  };
}

// ---- Start ----

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.setMcpServer(server);
  logger.info(`aggrowal-pr-review-mcp v${serverVersion} started`, {
    level: logConfig.level,
    filePath: logConfig.filePath ?? "none",
    sinks: ["stderr", "mcp", ...(logConfig.filePath ? ["file"] : [])],
  });
}

main().catch((err) => {
  logger.error("Fatal error during startup", { error: String(err) });
  process.exit(1);
});
