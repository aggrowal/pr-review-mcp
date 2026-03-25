import { describe, expect, it } from "vitest";
import {
  ReviewExecutionError,
  toReviewExecutionError,
  validateDraftForExecution,
  validateReviewOutput,
} from "../src/review/execute-review.js";
import type { TrackExecutionContract } from "../src/prompt/assemble.js";

function makeTrackContracts(): TrackExecutionContract[] {
  return [
    {
      trackId: "correctness",
      headings: [
        {
          id: "A",
          title: "Boundary Safety",
          subpoints: [1, 2],
        },
      ],
    },
  ];
}

function makeValidReportJson(): string {
  return JSON.stringify({
    schemaVersion: 1,
    project: "demo",
    branch: {
      head: "feature/contract",
      base: "main",
    },
    stack: {
      language: "typescript",
      frameworks: ["react"],
    },
    verdict: "NEEDS_DISCUSSION",
    contractCompliance: {
      status: "PASS",
    },
    trackCoverage: [
      {
        trackId: "correctness",
        overallStatus: "needs_improvement",
        headings: [
          {
            id: "A",
            title: "Boundary Safety",
            status: "needs_improvement",
            passedSubpoints: [1],
            failedSubpoints: [2],
            why: "Subpoint 2 fails due to missing null guard.",
          },
        ],
      },
    ],
    strengths: ["Validation path covers expected branches."],
    issues: [
      {
        status: "needs_improvement",
        trackId: "correctness",
        file: "src/app.ts",
        lines: "10-12",
        summary: "Missing null guard at API boundary.",
        why: "Null payload reaches serializer and fails at runtime.",
        betterImplementation: "Validate payload shape before read.",
      },
    ],
    summary: "One boundary issue should be addressed before merge.",
  });
}

describe("keyless review validation", () => {
  it("validates a correct draft and returns report", () => {
    const outcome = validateDraftForExecution({
      assembledPrompt: "Prompt body",
      draftReport: makeValidReportJson(),
      trackContracts: makeTrackContracts(),
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.report.verdict).toBe("NEEDS_DISCUSSION");
    }
  });

  it("returns actionable correction prompt on invalid draft", () => {
    const outcome = validateDraftForExecution({
      assembledPrompt: "Prompt body",
      draftReport: "not-json",
      trackContracts: makeTrackContracts(),
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.issues[0]).toContain("JSON object");
      expect(outcome.correctionPrompt).toContain("## Output correction required");
    }
  });

  it("accepts fenced JSON output in validation helper", () => {
    const raw = ["```json", makeValidReportJson(), "```"].join("\n");
    const validation = validateReviewOutput(raw, makeTrackContracts());
    expect(validation.ok).toBe(true);
  });

  it("converts validation failure to ReviewExecutionError", () => {
    const validation = validateReviewOutput("{}", makeTrackContracts());
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      const error = toReviewExecutionError(validation);
      expect(error).toBeInstanceOf(ReviewExecutionError);
      expect(error?.code).toBe("invalid_output");
    }
  });
});
