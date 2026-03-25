import { describe, expect, it } from "vitest";
import {
  buildRepairPrompt,
  validateReviewDraft,
} from "../src/review/validate-report.js";
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

function makeValidDraft() {
  return {
    schemaVersion: 1,
    project: "demo",
    branch: { head: "feature/test", base: "main" },
    stack: { language: "typescript", frameworks: ["react"] },
    verdict: "NEEDS_DISCUSSION",
    contractCompliance: { status: "PASS" },
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
            why: "Missing null checks in one path.",
          },
        ],
      },
    ],
    strengths: ["Good use of types."],
    issues: [
      {
        status: "needs_improvement",
        trackId: "correctness",
        summary: "Null check missing",
        why: "Can crash on undefined.",
      },
    ],
    summary: "One fix required.",
  };
}

describe("validateReviewDraft", () => {
  it("accepts a valid object draft", () => {
    const result = validateReviewDraft(makeValidDraft(), makeTrackContracts());
    expect(result.ok).toBe(true);
  });

  it("returns issues for malformed JSON", () => {
    const result = validateReviewDraft("{ invalid json", makeTrackContracts());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]).toContain("JSON");
    }
  });

  it("returns contract issues when required coverage is missing", () => {
    const badDraft = {
      ...makeValidDraft(),
      trackCoverage: [],
      contractCompliance: { status: "PASS" },
    };

    const result = validateReviewDraft(badDraft, makeTrackContracts());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join("\n")).toContain("Missing required track");
    }
  });
});

describe("buildRepairPrompt", () => {
  it("formats issue bullets for regeneration", () => {
    const prompt = buildRepairPrompt(["Issue A", "Issue B"]);
    expect(prompt).toContain("## Output correction required");
    expect(prompt).toContain("- Issue A");
    expect(prompt).toContain("- Issue B");
  });
});
