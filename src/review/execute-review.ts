import { performance } from "perf_hooks";
import {
  LlmProviderError,
  type LlmProvider,
  type LlmProviderConfig,
  type LlmUsage,
} from "../llm/provider.js";
import {
  createProvider,
  resolveProviderConfig,
} from "../llm/providers/index.js";
import type { Logger } from "../logger.js";
import type { TrackExecutionContract } from "../prompt/assemble.js";
import { ReviewReportSchema } from "../review-contract/schema.js";
import type { ReviewReport } from "../review-contract/types.js";

const EXECUTION_SYSTEM_PROMPT = [
  "You are a senior code reviewer executing server-defined review instructions.",
  "Return only a valid JSON object matching the requested schema.",
  "Do not wrap output in markdown or code fences.",
].join(" ");

export interface ExecuteReviewOptions {
  assembledPrompt: string;
  trackContracts: TrackExecutionContract[];
  logger: Logger;
  provider?: LlmProvider;
  providerConfig?: Partial<LlmProviderConfig>;
  maxRetries?: number;
  executionMode?: ReviewExecutionMode;
  samplingExecutor?: SamplingExecutor;
  samplingIncludeContext?: SamplingIncludeContext;
  samplingModelHint?: string;
}

export interface ExecuteReviewResult {
  report: ReviewReport;
  attempts: number;
  provider: string;
  model: string;
  latencyMs: number;
  usage?: LlmUsage;
}

export type ReviewExecutionErrorCode =
  | "sampling_unavailable"
  | "sampling_failed"
  | "provider_error"
  | "invalid_output"
  | "schema_invalid"
  | "contract_invalid";

export type ReviewExecutionMode =
  | "auto"
  | "provider_api"
  | "client_sampling";

export type SamplingIncludeContext = "none" | "thisServer" | "allServers";

export interface SamplingExecutorRequest {
  prompt: string;
  systemPrompt: string;
  maxTokens: number;
  temperature?: number;
  includeContext?: SamplingIncludeContext;
  modelHint?: string;
}

export interface SamplingExecutorResult {
  provider: string;
  model: string;
  text: string;
  usage?: LlmUsage;
}

export interface SamplingExecutor {
  generate(request: SamplingExecutorRequest): Promise<SamplingExecutorResult>;
}

export class ReviewExecutionError extends Error {
  readonly code: ReviewExecutionErrorCode;
  readonly detail?: string;
  readonly retryable: boolean;

  constructor(
    code: ReviewExecutionErrorCode,
    message: string,
    options?: { detail?: string; retryable?: boolean }
  ) {
    super(message);
    this.name = "ReviewExecutionError";
    this.code = code;
    this.detail = options?.detail;
    this.retryable = options?.retryable ?? false;
  }
}

export async function executeReview(
  options: ExecuteReviewOptions
): Promise<ExecuteReviewResult> {
  const executionMode = options.executionMode ?? "auto";
  let resolvedProviderConfig: LlmProviderConfig | undefined;
  let provider: LlmProvider | undefined = options.provider;

  const getProviderConfig = (): LlmProviderConfig => {
    if (!resolvedProviderConfig) {
      resolvedProviderConfig = resolveProviderConfig(options.providerConfig);
    }
    return resolvedProviderConfig;
  };

  const getProvider = (): LlmProvider => {
    if (provider) return provider;
    provider = createProvider(getProviderConfig());
    return provider;
  };

  const maxRetries = options.maxRetries ?? 1;

  let attempt = 0;
  let previousIssues: string[] = [];
  let lastUsage: LlmUsage | undefined;
  let totalLatencyMs = 0;

  while (attempt <= maxRetries) {
    attempt += 1;
    const repairPrompt = buildRepairPrompt(previousIssues);
    const executionPrompt =
      options.assembledPrompt + (repairPrompt ? `\n\n${repairPrompt}` : "");
    const attemptTarget = describeExecutionTarget(executionMode, options);

    options.logger.execution("attempt", {
      attempt,
      provider: attemptTarget.provider,
      model: attemptTarget.model,
      promptChars: executionPrompt.length,
    });

    const startedAt = performance.now();
    try {
      const response = await generateReviewResponse({
        executionMode,
        executionPrompt,
        options,
        getProvider,
        getProviderConfig,
      });
      totalLatencyMs += Math.round(performance.now() - startedAt);
      lastUsage = response.usage;

      const validation = validateReviewOutput(
        response.text,
        options.trackContracts
      );
      if (validation.ok) {
        return {
          report: validation.report,
          attempts: attempt,
          provider: response.provider,
          model: response.model,
          latencyMs: totalLatencyMs,
          usage: response.usage,
        };
      }

      previousIssues = validation.issues;
      options.logger.warn("Review output validation failed", {
        attempt,
        issueCount: validation.issues.length,
      });
    } catch (error) {
      totalLatencyMs += Math.round(performance.now() - startedAt);
      if (error instanceof ReviewExecutionError) {
        options.logger.warn("Execution call failed", {
          attempt,
          code: error.code,
          retryable: error.retryable,
        });

        if (attempt <= maxRetries && error.retryable) {
          previousIssues = [
            `Execution error (${error.code}): ${error.message}`,
            ...(error.detail ? [error.detail] : []),
          ];
          continue;
        }

        throw error;
      }

      if (error instanceof LlmProviderError) {
        options.logger.warn("Provider call failed", {
          attempt,
          code: error.code,
          retryable: error.retryable,
        });

        if (attempt <= maxRetries && error.retryable) {
          previousIssues = [
            `Provider error (${error.code}): ${error.message}`,
            ...(error.detail ? [error.detail] : []),
          ];
          continue;
        }

        throw new ReviewExecutionError(
          "provider_error",
          `Provider execution failed: ${error.message}`,
          {
            detail: error.detail,
            retryable: error.retryable,
          }
        );
      }

      throw new ReviewExecutionError(
        "provider_error",
        "Unexpected error during review execution.",
        {
          detail: String(error),
        }
      );
    }
  }

  throw new ReviewExecutionError(
    "invalid_output",
    "Review output remained invalid after retries.",
    {
      detail: JSON.stringify({
        issues: previousIssues,
        usage: lastUsage,
      }),
      retryable: false,
    }
  );
}

interface ValidationResultOk {
  ok: true;
  report: ReviewReport;
}

interface ValidationResultError {
  ok: false;
  issues: string[];
}

type ValidationResult = ValidationResultOk | ValidationResultError;

function validateReviewOutput(
  rawOutput: string,
  trackContracts: TrackExecutionContract[]
): ValidationResult {
  const parsedJson = parseJsonOutput(rawOutput);
  if (!parsedJson.ok) {
    return {
      ok: false,
      issues: [parsedJson.reason],
    };
  }

  const schemaParsed = ReviewReportSchema.safeParse(parsedJson.value);
  if (!schemaParsed.success) {
    return {
      ok: false,
      issues: schemaParsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`
      ),
    };
  }

  const report = schemaParsed.data;
  const contractIssues = validateTrackCoverageContract(report, trackContracts);
  const verdictIssue = validateVerdict(report);
  const allIssues = [...contractIssues, ...(verdictIssue ? [verdictIssue] : [])];

  if (allIssues.length > 0) {
    return {
      ok: false,
      issues: allIssues,
    };
  }

  return {
    ok: true,
    report,
  };
}

function buildRepairPrompt(issues: string[]): string {
  if (issues.length === 0) return "";
  const bullets = issues.slice(0, 20).map((issue) => `- ${issue}`).join("\n");
  return [
    "## Output correction required",
    "The previous response did not satisfy schema/contract requirements:",
    bullets,
    "Regenerate the full response as one valid JSON object and fix every listed issue.",
  ].join("\n");
}

function parseJsonOutput(rawOutput: string):
  | { ok: true; value: unknown }
  | { ok: false; reason: string } {
  const trimmed = rawOutput.trim();
  if (!trimmed) {
    return { ok: false, reason: "Model response is empty." };
  }

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return { ok: false, reason: "Model response does not contain a JSON object." };
  }

  const jsonSlice = candidate.slice(start, end + 1);
  try {
    return { ok: true, value: JSON.parse(jsonSlice) };
  } catch (error) {
    return {
      ok: false,
      reason: `Model response is not valid JSON: ${String(error)}`,
    };
  }
}

async function generateReviewResponse(params: {
  executionMode: ReviewExecutionMode;
  executionPrompt: string;
  options: ExecuteReviewOptions;
  getProvider: () => LlmProvider;
  getProviderConfig: () => LlmProviderConfig;
}): Promise<SamplingExecutorResult> {
  const {
    executionMode,
    executionPrompt,
    options,
    getProvider,
    getProviderConfig,
  } = params;

  if (executionMode === "client_sampling") {
    return runSamplingRequest(executionPrompt, options);
  }

  if (executionMode === "provider_api") {
    return runProviderRequest(executionPrompt, getProvider(), getProviderConfig());
  }

  if (options.samplingExecutor) {
    try {
      return await runSamplingRequest(executionPrompt, options);
    } catch (error) {
      if (!shouldFallbackFromSampling(error)) {
        throw error;
      }
      options.logger.warn(
        "Sampling unavailable; falling back to provider API execution",
        { detail: samplingErrorDetail(error) }
      );
    }
  }

  return runProviderRequest(executionPrompt, getProvider(), getProviderConfig());
}

async function runSamplingRequest(
  executionPrompt: string,
  options: ExecuteReviewOptions
): Promise<SamplingExecutorResult> {
  if (!options.samplingExecutor) {
    throw new ReviewExecutionError(
      "sampling_unavailable",
      "Sampling executor is not configured.",
      {
        retryable: false,
      }
    );
  }

  try {
    return await options.samplingExecutor.generate({
      prompt: executionPrompt,
      systemPrompt: EXECUTION_SYSTEM_PROMPT,
      maxTokens: options.providerConfig?.maxOutputTokens ?? 4096,
      temperature: options.providerConfig?.temperature,
      includeContext: options.samplingIncludeContext,
      modelHint: options.samplingModelHint,
    });
  } catch (error) {
    const detail = samplingErrorDetail(error);
    const code = isSamplingUnavailableError(error)
      ? "sampling_unavailable"
      : "sampling_failed";
    throw new ReviewExecutionError(code, "Client sampling request failed.", {
      detail,
      retryable: code === "sampling_failed",
    });
  }
}

async function runProviderRequest(
  executionPrompt: string,
  provider: LlmProvider,
  providerConfig: LlmProviderConfig
): Promise<SamplingExecutorResult> {
  const response = await provider.generate({
    prompt: executionPrompt,
    systemPrompt: EXECUTION_SYSTEM_PROMPT,
    timeoutMs: providerConfig.timeoutMs ?? 45000,
    maxOutputTokens: providerConfig.maxOutputTokens,
    temperature: providerConfig.temperature,
  });

  return {
    provider: response.provider,
    model: response.model,
    text: response.text,
    usage: response.usage,
  };
}

function shouldFallbackFromSampling(error: unknown): boolean {
  if (!(error instanceof ReviewExecutionError)) return false;
  return error.code === "sampling_unavailable";
}

function isSamplingUnavailableError(error: unknown): boolean {
  const detail = samplingErrorDetail(error).toLowerCase();
  return (
    detail.includes("method not found") ||
    detail.includes("sampling/create") ||
    detail.includes("capability") ||
    detail.includes("not support")
  );
}

function samplingErrorDetail(error: unknown): string {
  if (!error) return "unknown sampling error";
  if (error instanceof Error) return error.message;
  return String(error);
}

function describeExecutionTarget(
  executionMode: ReviewExecutionMode,
  options: ExecuteReviewOptions
): { provider: string; model: string } {
  if (executionMode === "client_sampling") {
    return {
      provider: "mcp_client_sampling",
      model: options.samplingModelHint ?? "client-selected",
    };
  }

  if (executionMode === "auto" && options.samplingExecutor) {
    return {
      provider: "auto",
      model: options.samplingModelHint ?? "sampling->provider-fallback",
    };
  }

  return {
    provider: "provider_api",
    model: options.providerConfig?.model ?? "default",
  };
}

function validateTrackCoverageContract(
  report: ReviewReport,
  trackContracts: TrackExecutionContract[]
): string[] {
  const issues: string[] = [];
  const expectedTrackIds = trackContracts.map((track) => track.trackId);
  const actualTrackIds = report.trackCoverage.map((track) => track.trackId);

  for (let index = 0; index < expectedTrackIds.length; index += 1) {
    if (actualTrackIds[index] !== expectedTrackIds[index]) {
      issues.push(
        `trackCoverage order mismatch at index ${index}. Expected "${expectedTrackIds[index]}", got "${actualTrackIds[index] ?? "missing"}".`
      );
    }
  }

  for (const actualTrackId of actualTrackIds) {
    if (!expectedTrackIds.includes(actualTrackId)) {
      issues.push(`Unexpected track in output: "${actualTrackId}".`);
    }
  }

  for (const contractTrack of trackContracts) {
    const actualTrack = report.trackCoverage.find(
      (track) => track.trackId === contractTrack.trackId
    );
    if (!actualTrack) {
      issues.push(`Missing required track "${contractTrack.trackId}".`);
      continue;
    }

    for (const contractHeading of contractTrack.headings) {
      const actualHeading = actualTrack.headings.find(
        (heading) => heading.id === contractHeading.id
      );
      if (!actualHeading) {
        issues.push(
          `Missing heading "${contractTrack.trackId}.${contractHeading.id}".`
        );
        continue;
      }

      const expectedSubpoints = new Set(contractHeading.subpoints);
      const actualSubpoints = [
        ...actualHeading.passedSubpoints,
        ...actualHeading.failedSubpoints,
      ];
      const uniqueActualSubpoints = new Set(actualSubpoints);

      if (actualSubpoints.length !== uniqueActualSubpoints.size) {
        issues.push(
          `Heading "${contractTrack.trackId}.${contractHeading.id}" contains duplicate subpoint assignments.`
        );
      }

      for (const expected of expectedSubpoints) {
        if (!uniqueActualSubpoints.has(expected)) {
          issues.push(
            `Missing subpoint "${contractTrack.trackId}.${contractHeading.id}.${expected}".`
          );
        }
      }

      for (const actual of uniqueActualSubpoints) {
        if (!expectedSubpoints.has(actual)) {
          issues.push(
            `Unexpected subpoint "${contractTrack.trackId}.${contractHeading.id}.${actual}".`
          );
        }
      }

      if (
        actualHeading.failedSubpoints.length === 0 &&
        actualHeading.why.trim().toLowerCase() !== "all pointers are positive"
      ) {
        issues.push(
          `Heading "${contractTrack.trackId}.${contractHeading.id}" must use "all pointers are positive" when no failed subpoints exist.`
        );
      }
    }

    for (const actualHeading of actualTrack.headings) {
      if (!contractTrack.headings.some((heading) => heading.id === actualHeading.id)) {
        issues.push(
          `Unexpected heading "${contractTrack.trackId}.${actualHeading.id}" in output.`
        );
      }
    }
  }

  const normalizedGaps = normalizeContractGaps(issues);
  if (normalizedGaps.length === 0) {
    if (report.contractCompliance.status !== "PASS") {
      issues.push("contractCompliance.status must be PASS when no gaps exist.");
    }
    return issues;
  }

  if (report.contractCompliance.status !== "FAIL") {
    issues.push("contractCompliance.status must be FAIL when gaps exist.");
  }

  if (!report.contractCompliance.gaps || report.contractCompliance.gaps.length === 0) {
    issues.push("contractCompliance.gaps must list missing coverage details.");
  }

  if (!report.contractCompliance.reason) {
    issues.push("contractCompliance.reason must explain why coverage is incomplete.");
  }

  return issues;
}

function normalizeContractGaps(issues: string[]): string[] {
  const gapSignals = ["Missing", "Unexpected", "mismatch", "duplicate"];
  return issues.filter((issue) =>
    gapSignals.some((signal) => issue.includes(signal))
  );
}

function validateVerdict(report: ReviewReport): string | undefined {
  const statuses = report.issues.map((issue) => issue.status);
  if (statuses.includes("blocker") && report.verdict !== "REQUEST_CHANGES") {
    return "verdict must be REQUEST_CHANGES when blocker issues are present.";
  }

  if (
    !statuses.includes("blocker") &&
    statuses.includes("needs_improvement") &&
    report.verdict !== "NEEDS_DISCUSSION"
  ) {
    return "verdict must be NEEDS_DISCUSSION when needs_improvement issues are present and no blocker exists.";
  }

  if (
    !statuses.includes("blocker") &&
    !statuses.includes("needs_improvement") &&
    report.verdict !== "APPROVE"
  ) {
    return "verdict must be APPROVE when issues are only nudge/looks_good or empty.";
  }

  return undefined;
}
