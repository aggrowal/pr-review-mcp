import { z } from "zod";
import type { LlmUsage } from "../llm/provider.js";
import type { ReviewReport } from "../review-contract/types.js";
import type { ReviewExecutionError } from "./execute-review.js";

const UsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

export const PrReviewSuccessSchema = z
  .object({
    ok: z.literal(true),
    review: z.unknown(),
    meta: z
      .object({
        provider: z.string().min(1),
        model: z.string().min(1),
        attempts: z.number().int().positive(),
        latencyMs: z.number().int().nonnegative(),
        usage: UsageSchema.optional(),
      })
      .strict(),
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

export function buildPrReviewSuccessJson(params: {
  review: ReviewReport;
  provider: string;
  model: string;
  attempts: number;
  latencyMs: number;
  usage?: LlmUsage;
}): string {
  return JSON.stringify(
    {
      ok: true,
      review: params.review,
      meta: {
        provider: params.provider,
        model: params.model,
        attempts: params.attempts,
        latencyMs: params.latencyMs,
        usage: params.usage,
      },
    },
    null,
    2
  );
}

export function buildPrReviewErrorJson(error: ReviewExecutionError): string {
  return JSON.stringify(
    {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        detail: error.detail,
        retryable: error.retryable,
      },
    },
    null,
    2
  );
}
