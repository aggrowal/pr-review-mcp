import { describe, expect, it } from "vitest";
import { ReviewReportSchema } from "../src/review-contract/schema.js";
import {
  PrReviewErrorSchema,
  PrReviewFinalSchema,
  PrReviewPrepareSchema,
  PrReviewRepairSchema,
  buildPrReviewErrorJson,
  buildPrReviewErrorJsonFromFields,
  buildPrReviewFinalJson,
  buildPrReviewPrepareJson,
  buildPrReviewRepairJson,
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
  it("builds prepare payload with session + prompt contract", () => {
    const json = buildPrReviewPrepareJson({
      sessionId: "session-1",
      attempt: 0,
      maxAttempts: 3,
      expiresAt: "2026-03-25T00:00:00.000Z",
      prompt: "Assembled prompt content",
      trackContracts: [{ trackId: "correctness", headings: [] }],
    });

    const parsed = JSON.parse(json) as unknown;
    const wrapper = PrReviewPrepareSchema.safeParse(parsed);
    expect(wrapper.success).toBe(true);
    if (wrapper.success) {
      expect(wrapper.data.meta.server).toBe("aggrowal-pr-review-mcp");
      expect(wrapper.data.meta.stage).toBe("prepare");
      expect(wrapper.data.meta.contractVersion).toBe(1);
      expect(wrapper.data.session.sessionId).toBe("session-1");
      expect(wrapper.data.nextAction.type).toBe("generate_and_validate");
      expect(wrapper.data.nextAction.callTemplate.tool).toBe("pr_review");
      expect(wrapper.data.nextAction.callTemplate.arguments.sessionId).toBe("session-1");
      expect(wrapper.data.nextAction.callTemplate.arguments.draftReport).toContain(
        "<replace_with_generated_review"
      );
    }
  });

  it("builds repair payload with actionable issues", () => {
    const json = buildPrReviewRepairJson({
      sessionId: "session-1",
      attempt: 1,
      maxAttempts: 3,
      expiresAt: "2026-03-25T00:00:00.000Z",
      validationIssues: ["Missing required track \"correctness\"."],
      correctionPrompt: "Prompt + repair directives",
    });

    const parsed = JSON.parse(json) as unknown;
    const wrapper = PrReviewRepairSchema.safeParse(parsed);
    expect(wrapper.success).toBe(true);
    if (wrapper.success) {
      expect(wrapper.data.meta.server).toBe("aggrowal-pr-review-mcp");
      expect(wrapper.data.meta.stage).toBe("repair");
      expect(wrapper.data.meta.contractVersion).toBe(1);
      expect(wrapper.data.validationIssues).toHaveLength(1);
      expect(wrapper.data.nextAction.type).toBe("regenerate_and_validate");
      expect(wrapper.data.nextAction.callTemplate.tool).toBe("pr_review");
      expect(wrapper.data.nextAction.callTemplate.arguments.sessionId).toBe("session-1");
      expect(wrapper.data.nextAction.callTemplate.arguments.draftReport).toContain(
        "<replace_with_corrected_review"
      );
    }
  });

  it("builds final payload with valid report shape", () => {
    const report = makeReviewReport();
    const json = buildPrReviewFinalJson({
      review: report,
      sessionId: "session-1",
      validationAttempts: 2,
      model: "claude-sonnet",
      markdown: "# PR Review",
    });

    const parsed = JSON.parse(json) as unknown;
    const wrapper = PrReviewFinalSchema.safeParse(parsed);
    expect(wrapper.success).toBe(true);
    if (wrapper.success) {
      expect(ReviewReportSchema.safeParse(wrapper.data.review).success).toBe(true);
      expect(wrapper.data.meta.server).toBe("aggrowal-pr-review-mcp");
      expect(wrapper.data.meta.stage).toBe("final");
      expect(wrapper.data.meta.contractVersion).toBe(1);
      expect(wrapper.data.meta.validationAttempts).toBe(2);
    }
  });

  it("builds error payload with machine-readable fields", () => {
    const json = buildPrReviewErrorJson({
      code: "invalid_output",
      message: "invalid json",
      detail: "parse failure",
      retryable: false,
    });

    const parsed = JSON.parse(json) as unknown;
    const wrapper = PrReviewErrorSchema.safeParse(parsed);
    expect(wrapper.success).toBe(true);
    if (wrapper.success) {
      expect(wrapper.data.meta.server).toBe("aggrowal-pr-review-mcp");
      expect(wrapper.data.meta.stage).toBe("error");
      expect(wrapper.data.meta.contractVersion).toBe(1);
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
      expect(wrapper.data.meta.stage).toBe("error");
      expect(wrapper.data.error.code).toBe("project_guard_failed");
      expect(wrapper.data.error.message).toContain("git repository");
    }
  });
});
