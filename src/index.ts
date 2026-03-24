#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type {
  CreateMessageResult,
  CreateMessageResultWithTools,
} from "@modelcontextprotocol/sdk/types.js";
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
import { SKILL_REGISTRY } from "./skills/registry.js";
import { buildAssembledPromptWithTelemetry } from "./prompt/assemble.js";
import {
  executeReview,
  ReviewExecutionError,
  type SamplingExecutor,
  type SamplingExecutorRequest,
} from "./review/execute-review.js";
import {
  buildPrReviewErrorJson,
  buildPrReviewErrorJsonFromFields,
  buildPrReviewSuccessJson,
} from "./review/tool-result.js";
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
const samplingExecutor = createMcpSamplingExecutor();

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
  "Run a full PR review on a specified branch. " +
    "Usage: @pr_review branch: feature/my-branch [reviewInstructions: focus areas]",
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
    reviewInstructions: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .describe(
        "Optional trusted reviewer focus/instructions to include in prompt assembly (max 2000 chars)."
      ),
  },
  async ({ branch, cwd: cwdArg, reviewInstructions }) => {
    const cwd = cwdArg ?? process.cwd();
    const trustedReviewInstructions =
      reviewInstructions && reviewInstructions.length > 0
        ? reviewInstructions
        : undefined;
    logger.info(`pr_review: starting`, { branch, cwd });

    // T1: Project guard
    const endT1 = logger.startStep("T1: Project guard");
    const guard = runProjectGuard(cwd, logger);
    if (!guard.ok) {
      logger.error(`T1: Project guard failed -- ${guard.reason}`, { hint: guard.hint, detail: guard.detail });
      endT1({ status: "failed" });
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: buildPrReviewErrorJsonFromFields({
              code: "project_guard_failed",
              message: guard.reason,
              detail: [guard.hint, guard.detail].filter(Boolean).join("\n\n"),
              retryable: false,
            }),
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
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: buildPrReviewErrorJsonFromFields({
              code: "branch_resolution_failed",
              message: branchResult.reason,
              detail: [branchResult.hint, branchResult.detail]
                .filter(Boolean)
                .join("\n\n"),
              retryable: false,
            }),
          },
        ],
      };
    }
    endT2({ head: branchResult.context.headBranch, base: branchResult.context.baseBranch });

    // T3: Diff extractor
    const endT3 = logger.startStep("T3: Diff extractor");
    const diffResult = runDiffExtractor(branchResult.context, logger, {
      enrichment: config.reviewRuntime.enrichment,
    });
    if (!diffResult.ok) {
      logger.error(`T3: Diff extractor failed -- ${diffResult.reason}`, { hint: diffResult.hint, detail: diffResult.detail });
      endT3({ status: "failed" });
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: buildPrReviewErrorJsonFromFields({
              code: "diff_extraction_failed",
              message: diffResult.reason,
              detail: [diffResult.hint, diffResult.detail]
                .filter(Boolean)
                .join("\n\n"),
              retryable: false,
            }),
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
    endDetect({ language: detectedCtx.language, frameworks: detectedCtx.framework, patterns: detectedCtx.patterns, matched: matched.length, skipped: skipped.length });

    // Assembly
    const endAssembly = logger.startStep("Assembly");
    const assembled = buildAssembledPromptWithTelemetry(
      diff,
      detectedCtx,
      matched,
      skipped,
      { reviewInstructions: trustedReviewInstructions }
    );
    const assembledPrompt = assembled.prompt;
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

    // Execute review
    const endExecution = logger.startStep("Execution");
    try {
      const execution = await executeReview({
        assembledPrompt,
        trackContracts: assembled.trackContracts,
        logger,
        providerConfig: config.reviewRuntime,
        maxRetries: config.reviewRuntime.maxRetries,
        executionMode: config.reviewRuntime.executionMode,
        samplingExecutor,
        samplingIncludeContext: config.reviewRuntime.samplingIncludeContext,
        samplingModelHint: config.reviewRuntime.samplingModelHint,
      });

      logger.execution("complete", {
        provider: execution.provider,
        model: execution.model,
        attempts: execution.attempts,
        latencyMs: execution.latencyMs,
        inputTokens: execution.usage?.inputTokens,
        outputTokens: execution.usage?.outputTokens,
        totalTokens: execution.usage?.totalTokens,
      });
      endExecution({
        provider: execution.provider,
        model: execution.model,
        attempts: execution.attempts,
        latencyMs: execution.latencyMs,
      });

      logger.info("pr_review: complete");
      return {
        content: [
          {
            type: "text" as const,
            text: buildPrReviewSuccessJson({
              review: execution.report,
              provider: execution.provider,
              model: execution.model,
              attempts: execution.attempts,
              latencyMs: execution.latencyMs,
              usage: execution.usage,
            }),
          },
        ],
      };
    } catch (error) {
      endExecution({ status: "failed" });

      const executionError =
        error instanceof ReviewExecutionError
          ? error
          : new ReviewExecutionError(
              "provider_error",
              "Unexpected execution failure.",
              { detail: String(error) }
            );

      logger.error("Review execution failed", {
        code: executionError.code,
        detail: executionError.detail,
      });

      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: buildPrReviewErrorJson(executionError),
          },
        ],
      };
    }
  }
);

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

function createMcpSamplingExecutor(): SamplingExecutor {
  return {
    async generate(
      request: SamplingExecutorRequest
    ): Promise<{
      provider: string;
      model: string;
      text: string;
    }> {
      const response = await server.server.createMessage({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: request.prompt,
            },
          },
        ],
        systemPrompt: request.systemPrompt,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        includeContext: request.includeContext,
        modelPreferences: request.modelHint
          ? {
              hints: [{ name: request.modelHint }],
            }
          : undefined,
      });

      const text = extractSamplingText(response);
      if (!text) {
        throw new Error(
          "Sampling response did not include text content in assistant message."
        );
      }

      return {
        provider: "mcp_client_sampling",
        model: response.model,
        text,
      };
    },
  };
}

function extractSamplingText(
  response: CreateMessageResult | CreateMessageResultWithTools
): string {
  const chunks = Array.isArray(response.content)
    ? response.content
    : [response.content];
  return chunks
    .filter((chunk): chunk is { type: "text"; text: string } => {
      return chunk.type === "text" && typeof chunk.text === "string";
    })
    .map((chunk) => chunk.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}
