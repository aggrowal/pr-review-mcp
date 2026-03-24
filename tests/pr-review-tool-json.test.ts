import { describe, expect, it } from "vitest";
import { ReviewReportSchema } from "../src/review-contract/schema.js";
import { ReviewExecutionError } from "../src/review/execute-review.js";
import {
  PrReviewErrorSchema,
  PrReviewSuccessSchema,
  buildPrReviewErrorJson,
  buildPrReviewErrorJsonFromFields,
  buildPrReviewSuccessJson,
} from "../src/review/tool-result.js";

function makeReviewReport() {
  return {
    schemaVersion: 1 as const,
    project: "demo",
    branch: {
      head: "feature/demo",
      base: "main",
    },
    stack: {
      language: "typescript",
      frameworks: ["react"],
    },
    verdict: "APPROVE" as const,
    contractCompliance: {
      status: "PASS" as const,
    },
    trackCoverage: [
      {
        trackId: "correctness",
        overallStatus: "looks_good" as const,
        headings: [
          {
            id: "A",
            title: "Boundary Safety",
            status: "looks_good" as const,
            passedSubpoints: [1, 2],
            failedSubpoints: [],
            why: "all pointers are positive",
          },
        ],
      },
    ],
    strengths: ["Clear and safe boundary checks."],
    issues: [],
    summary: "No blocking issues detected.",
  };
}

describe("pr_review JSON tool payload", () => {
  it("builds success payload with valid report shape", () => {
    const report = makeReviewReport();
    const json = buildPrReviewSuccessJson({
      review: report,
      provider: "openai",
      model: "gpt-4.1-mini",
      attempts: 1,
      latencyMs: 532,
      usage: {
        inputTokens: 1200,
        outputTokens: 450,
        totalTokens: 1650,
      },
    });

    const parsed = JSON.parse(json) as unknown;
    const wrapper = PrReviewSuccessSchema.safeParse(parsed);
    expect(wrapper.success).toBe(true);
    if (wrapper.success) {
      expect(ReviewReportSchema.safeParse(wrapper.data.review).success).toBe(true);
    }
  });

  it("builds error payload with machine-readable fields", () => {
    const error = new ReviewExecutionError("invalid_output", "invalid json", {
      detail: "parse failure",
      retryable: false,
    });
    const json = buildPrReviewErrorJson(error);
    const parsed = JSON.parse(json) as unknown;
    const wrapper = PrReviewErrorSchema.safeParse(parsed);
    expect(wrapper.success).toBe(true);
    if (wrapper.success) {
      expect(wrapper.data.error.code).toBe("invalid_output");
      expect(wrapper.data.error.retryable).toBe(false);
    }
  });

  it("builds preflight error payloads with stable codes", () => {
    const json = buildPrReviewErrorJsonFromFields({
      code: "project_guard_failed",
      message: "Not inside a git repository.",
      detail: "Navigate to a repository.",
      retryable: false,
    });

    const parsed = JSON.parse(json) as unknown;
    const wrapper = PrReviewErrorSchema.safeParse(parsed);
    expect(wrapper.success).toBe(true);
    if (wrapper.success) {
      expect(wrapper.data.error.code).toBe("project_guard_failed");
      expect(wrapper.data.error.message).toContain("git repository");
    }
  });
});
