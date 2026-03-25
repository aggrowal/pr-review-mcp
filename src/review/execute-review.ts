import type { TrackExecutionContract } from "../prompt/assemble.js";
import type { ReviewReport } from "../review-contract/types.js";
import {
  buildRepairPrompt,
  validateReviewDraft,
  type ReportValidationResult,
} from "./validate-report.js";

export type ReviewExecutionErrorCode =
  | "invalid_output"
  | "schema_invalid"
  | "contract_invalid"
  | "verdict_invalid";

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

export interface KeylessValidationOutcome {
  ok: true;
  report: ReviewReport;
}

export interface KeylessValidationFailure {
  ok: false;
  issues: string[];
  correctionPrompt: string;
}

export type KeylessValidationResult =
  | KeylessValidationOutcome
  | KeylessValidationFailure;

export function validateDraftForExecution(options: {
  assembledPrompt: string;
  draftReport: string | unknown;
  trackContracts: TrackExecutionContract[];
}): KeylessValidationResult {
  const validation = validateReviewDraft(options.draftReport, options.trackContracts);
  if (validation.ok) {
    return {
      ok: true,
      report: validation.report,
    };
  }

  return {
    ok: false,
    issues: validation.issues,
    correctionPrompt: [
      options.assembledPrompt,
      buildRepairPrompt(validation.issues),
    ].join("\n\n"),
  };
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

export function validateReviewOutput(
  rawOutput: string | unknown,
  trackContracts: TrackExecutionContract[]
): ValidationResult {
  const validation = validateReviewDraft(rawOutput, trackContracts);
  if (!validation.ok) {
    return {
      ok: false,
      issues: validation.issues,
    };
  }

  return {
    ok: true,
    report: validation.report,
  };
}

export function toReviewExecutionError(
  validation: ReportValidationResult
): ReviewExecutionError | undefined {
  if (validation.ok) return undefined;
  return new ReviewExecutionError(
    "invalid_output",
    "Draft report failed schema/contract validation.",
    {
      detail: validation.issues.join("\n"),
      retryable: false,
    }
  );
}
