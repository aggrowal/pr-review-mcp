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

export const REVIEW_STAGE_CONTRACT_VERSION = 1 as const;
const REVIEW_STAGE_SERVER = "aggrowal-pr-review-mcp";

const SessionSchema = z
  .object({
    sessionId: z.string().min(1),
    attempt: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    expiresAt: z.string().datetime(),
  })
  .strict();

const ValidationIssueSchema = z.array(z.string().min(1));

const StageAttestationSchema = z
  .object({
    server: z.literal(REVIEW_STAGE_SERVER),
    stage: z.enum(["prepare", "repair", "final", "error"]),
    contractVersion: z.literal(REVIEW_STAGE_CONTRACT_VERSION),
  })
  .strict();

const NextActionCallTemplateSchema = z
  .object({
    tool: z.literal("pr_review"),
    arguments: z
      .object({
        sessionId: z.string().min(1),
        draftReport: z.string().min(1),
        model: z.string().min(1).optional(),
        format: z.enum(["json", "markdown"]).optional(),
      })
      .strict(),
  })
  .strict();

export const PrReviewPrepareSchema = z
  .object({
    ok: z.literal(true),
    stage: z.literal("prepare"),
    meta: StageAttestationSchema.extend({
      stage: z.literal("prepare"),
    }),
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
        callTemplate: NextActionCallTemplateSchema,
      })
      .strict(),
  })
  .strict();

export const PrReviewRepairSchema = z
  .object({
    ok: z.literal(true),
    stage: z.literal("repair"),
    meta: StageAttestationSchema.extend({
      stage: z.literal("repair"),
    }),
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
        callTemplate: NextActionCallTemplateSchema,
      })
      .strict(),
  })
  .strict();

export const PrReviewFinalSchema = z
  .object({
    ok: z.literal(true),
    stage: z.literal("final"),
    review: z.unknown(),
    meta: StageAttestationSchema.extend({
      stage: z.literal("final"),
      sessionId: z.string().min(1),
      validationAttempts: z.number().int().positive(),
      model: z.string().min(1).optional(),
    }),
    markdown: z.string().optional(),
  })
  .strict();

export const PrReviewErrorSchema = z
  .object({
    ok: z.literal(false),
    meta: StageAttestationSchema.extend({
      stage: z.literal("error"),
    }),
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
      meta: {
        server: REVIEW_STAGE_SERVER,
        stage: "prepare",
        contractVersion: REVIEW_STAGE_CONTRACT_VERSION,
      },
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
          "Generate one JSON report that follows payload.prompt exactly, then call pr_review again using nextAction.callTemplate with the same sessionId and the generated draftReport.",
        callTemplate: {
          tool: "pr_review",
          arguments: {
            sessionId: params.sessionId,
            draftReport: "<replace_with_generated_review_json_object_or_string>",
            format: "json",
            model: "<optional_host_model_identifier>",
          },
        },
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
      meta: {
        server: REVIEW_STAGE_SERVER,
        stage: "repair",
        contractVersion: REVIEW_STAGE_CONTRACT_VERSION,
      },
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
          "Regenerate the full JSON report using payload.correctionPrompt, then call pr_review again using nextAction.callTemplate with the same sessionId and the corrected draftReport.",
        callTemplate: {
          tool: "pr_review",
          arguments: {
            sessionId: params.sessionId,
            draftReport: "<replace_with_corrected_review_json_object_or_string>",
            format: "json",
            model: "<optional_host_model_identifier>",
          },
        },
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
        server: REVIEW_STAGE_SERVER,
        stage: "final",
        contractVersion: REVIEW_STAGE_CONTRACT_VERSION,
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
      meta: {
        server: REVIEW_STAGE_SERVER,
        stage: "error",
        contractVersion: REVIEW_STAGE_CONTRACT_VERSION,
      },
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
