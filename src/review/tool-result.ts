import { z } from "zod";
import type { ReviewReport } from "../review-contract/types.js";

export type PrReviewToolErrorCode =
  | "project_guard_failed"
  | "branch_resolution_failed"
  | "diff_extraction_failed"
  | "budget_exceeded"
  | "invalid_output"
  | "schema_invalid"
  | "contract_invalid"
  | "verdict_invalid"
  | "session_not_found"
  | "session_expired"
  | "validate_request_invalid"
  | "validation_attempts_exhausted"
  | "internal_error";

export interface PrReviewToolError {
  code: PrReviewToolErrorCode;
  message: string;
  detail?: string;
  retryable?: boolean;
}

const SessionSchema = z
  .object({
    sessionId: z.string().min(1),
    attempt: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    expiresAt: z.string().datetime(),
  })
  .strict();

const ValidationIssueSchema = z.array(z.string().min(1));

export const PrReviewPrepareSchema = z
  .object({
    ok: z.literal(true),
    stage: z.literal("prepare"),
    session: SessionSchema,
    payload: z
      .object({
        prompt: z.string().min(1),
        trackContracts: z.array(z.unknown()),
      })
      .strict(),
    nextAction: z
      .object({
        type: z.literal("generate_and_validate"),
        instructions: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const PrReviewRepairSchema = z
  .object({
    ok: z.literal(true),
    stage: z.literal("repair"),
    session: SessionSchema,
    validationIssues: ValidationIssueSchema,
    payload: z
      .object({
        correctionPrompt: z.string().min(1),
      })
      .strict(),
    nextAction: z
      .object({
        type: z.literal("regenerate_and_validate"),
        instructions: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const PrReviewFinalSchema = z
  .object({
    ok: z.literal(true),
    stage: z.literal("final"),
    review: z.unknown(),
    meta: z
      .object({
        sessionId: z.string().min(1),
        validationAttempts: z.number().int().positive(),
        model: z.string().min(1).optional(),
      })
      .strict(),
    markdown: z.string().optional(),
  })
  .strict();

export const PrReviewErrorSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        detail: z.string().optional(),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

export function buildPrReviewPrepareJson(params: {
  sessionId: string;
  attempt: number;
  maxAttempts: number;
  expiresAt: string;
  prompt: string;
  trackContracts: unknown[];
}): string {
  return JSON.stringify(
    {
      ok: true,
      stage: "prepare",
      session: {
        sessionId: params.sessionId,
        attempt: params.attempt,
        maxAttempts: params.maxAttempts,
        expiresAt: params.expiresAt,
      },
      payload: {
        prompt: params.prompt,
        trackContracts: params.trackContracts,
      },
      nextAction: {
        type: "generate_and_validate",
        instructions:
          "Generate one JSON report that follows payload.prompt exactly, then call pr_review again with sessionId and draftReport.",
      },
    },
    null,
    2
  );
}

export function buildPrReviewRepairJson(params: {
  sessionId: string;
  attempt: number;
  maxAttempts: number;
  expiresAt: string;
  validationIssues: string[];
  correctionPrompt: string;
}): string {
  return JSON.stringify(
    {
      ok: true,
      stage: "repair",
      session: {
        sessionId: params.sessionId,
        attempt: params.attempt,
        maxAttempts: params.maxAttempts,
        expiresAt: params.expiresAt,
      },
      validationIssues: params.validationIssues,
      payload: {
        correctionPrompt: params.correctionPrompt,
      },
      nextAction: {
        type: "regenerate_and_validate",
        instructions:
          "Regenerate the full JSON report using payload.correctionPrompt, then call pr_review again with the same sessionId and the new draftReport.",
      },
    },
    null,
    2
  );
}

export function buildPrReviewFinalJson(params: {
  review: ReviewReport;
  sessionId: string;
  validationAttempts: number;
  model?: string;
  markdown?: string;
}): string {
  return JSON.stringify(
    {
      ok: true,
      stage: "final",
      review: params.review,
      meta: {
        sessionId: params.sessionId,
        validationAttempts: params.validationAttempts,
        model: params.model,
      },
      markdown: params.markdown,
    },
    null,
    2
  );
}

export function buildPrReviewErrorJson(error: PrReviewToolError): string {
  return buildPrReviewErrorJsonFromFields({
    code: error.code,
    message: error.message,
    detail: error.detail,
    retryable: error.retryable,
  });
}

export function buildPrReviewErrorJsonFromFields(params: {
  code: PrReviewToolErrorCode;
  message: string;
  detail?: string;
  retryable?: boolean;
}): string {
  return JSON.stringify(
    {
      ok: false,
      error: {
        code: params.code,
        message: params.message,
        detail: params.detail,
        retryable: params.retryable ?? false,
      },
    },
    null,
    2
  );
}
