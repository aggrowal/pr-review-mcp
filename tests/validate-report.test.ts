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

function makeTwoTrackContracts(): TrackExecutionContract[] {
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
    {
      trackId: "testing-quality",
      headings: [
        {
          id: "A",
          title: "Critical Paths",
          subpoints: [1],
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

function makeValidTwoTrackDraft() {
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
            why: "Boundary guard missing for one path.",
          },
        ],
      },
      {
        trackId: "testing-quality",
        overallStatus: "looks_good",
        headings: [
          {
            id: "A",
            title: "Critical Paths",
            status: "looks_good",
            passedSubpoints: [1],
            failedSubpoints: [],
            why: "all pointers are positive",
          },
        ],
      },
    ],
    strengths: ["Good coverage on stable flows."],
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
      const issues = result.issues.join("\n");
      expect(issues).toContain("Missing required track");
      expect(issues).toContain("contractCompliance.status must be FAIL");
      expect(issues).toContain("contractCompliance.gaps must list");
      expect(issues).toContain("contractCompliance.reason must explain");
    }
  });

  it("returns verdict error when blocker issues use non-request-changes verdict", () => {
    const badDraft = {
      ...makeValidDraft(),
      issues: [
        {
          status: "blocker",
          trackId: "correctness",
          summary: "Critical crash risk",
          why: "Can trigger production outage.",
        },
      ],
      verdict: "NEEDS_DISCUSSION",
    };

    const result = validateReviewDraft(badDraft, makeTrackContracts());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join("\n")).toContain(
        "verdict must be REQUEST_CHANGES when blocker issues are present."
      );
    }
  });

  it("returns contract issues when track order does not match execution contract", () => {
    const badDraft = makeValidTwoTrackDraft();
    badDraft.trackCoverage = [...badDraft.trackCoverage].reverse();

    const result = validateReviewDraft(badDraft, makeTwoTrackContracts());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join("\n")).toContain("trackCoverage order mismatch");
    }
  });

  it("returns contract issues for missing and unexpected headings", () => {
    const badDraft = {
      ...makeValidDraft(),
      trackCoverage: [
        {
          ...makeValidDraft().trackCoverage[0],
          headings: [
            {
              id: "B",
              title: "Different Heading",
              status: "nudge",
              passedSubpoints: [1],
              failedSubpoints: [],
              why: "all pointers are positive",
            },
          ],
        },
      ],
    };

    const result = validateReviewDraft(badDraft, makeTrackContracts());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issues = result.issues.join("\n");
      expect(issues).toContain('Missing heading "correctness.A".');
      expect(issues).toContain('Unexpected heading "correctness.B" in output.');
    }
  });

  it("returns contract issues for missing and unexpected subpoints", () => {
    const badDraft = {
      ...makeValidDraft(),
      trackCoverage: [
        {
          ...makeValidDraft().trackCoverage[0],
          headings: [
            {
              ...makeValidDraft().trackCoverage[0].headings[0],
              passedSubpoints: [1],
              failedSubpoints: [3],
              why: "Subpoint 3 failed unexpectedly.",
            },
          ],
        },
      ],
    };

    const result = validateReviewDraft(badDraft, makeTrackContracts());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issues = result.issues.join("\n");
      expect(issues).toContain('Missing subpoint "correctness.A.2".');
      expect(issues).toContain('Unexpected subpoint "correctness.A.3".');
    }
  });

  it("returns contract compliance mismatch when FAIL is reported without gaps", () => {
    const badDraft = {
      ...makeValidDraft(),
      contractCompliance: {
        status: "FAIL",
        gaps: ["none"],
        reason: "No actual gap, incorrect status.",
      },
    };

    const result = validateReviewDraft(badDraft, makeTrackContracts());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join("\n")).toContain(
        "contractCompliance.status must be PASS when no gaps exist."
      );
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
