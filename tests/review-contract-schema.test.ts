import { describe, expect, it } from "vitest";
import { ReviewReportSchema } from "../src/review-contract/schema.js";

function makeValidReport() {
  return {
    schemaVersion: 1 as const,
    project: "demo",
    branch: {
      head: "feature/auth",
      base: "main",
    },
    stack: {
      language: "typescript",
      frameworks: ["react"],
    },
    verdict: "REQUEST_CHANGES" as const,
    contractCompliance: {
      status: "PASS" as const,
    },
    trackCoverage: [
      {
        trackId: "correctness",
        overallStatus: "needs_improvement" as const,
        headings: [
          {
            id: "A",
            title: "Contract and Invariant Correctness",
            status: "needs_improvement" as const,
            passedSubpoints: [1, 3],
            failedSubpoints: [2],
            why: "Subpoint 2 fails due to missing invariant check.",
          },
          {
            id: "B",
            title: "Data Integrity and Mutation Safety",
            status: "looks_good" as const,
            passedSubpoints: [1, 2],
            failedSubpoints: [],
            why: "all pointers are positive",
          },
        ],
      },
    ],
    strengths: ["Good input validation in request parser."],
    issues: [
      {
        status: "needs_improvement" as const,
        trackId: "correctness",
        file: "src/auth/login.ts",
        lines: "40-50",
        summary: "Missing null check before token construction.",
        why: "Can throw at runtime when user record is partially loaded.",
        betterImplementation: "Guard null and return explicit unauthorized response.",
      },
    ],
    summary: "Core flow is solid but one correctness issue should be fixed before merge.",
  };
}

describe("ReviewReportSchema", () => {
  it("accepts a valid report object", () => {
    const parsed = ReviewReportSchema.safeParse(makeValidReport());
    expect(parsed.success).toBe(true);
  });

  it("rejects FAIL compliance without gaps and reason", () => {
    const payload = makeValidReport();
    payload.contractCompliance = {
      status: "FAIL",
    };

    const parsed = ReviewReportSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const messages = parsed.error.issues.map((issue) => issue.message);
      expect(messages).toContain("gaps are required when contract compliance is FAIL");
      expect(messages).toContain("reason is required when contract compliance is FAIL");
    }
  });

  it("rejects overlapping passed and failed subpoints", () => {
    const payload = makeValidReport();
    payload.trackCoverage[0].headings[0].failedSubpoints = [2, 3];

    const parsed = ReviewReportSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const messages = parsed.error.issues.map((issue) => issue.message);
      expect(messages).toContain("subpoint id cannot be both passed and failed");
    }
  });

  it("rejects unknown top-level keys in strict mode", () => {
    const payload = {
      ...makeValidReport(),
      extraField: true,
    };

    const parsed = ReviewReportSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it("rejects duplicate track ids in trackCoverage", () => {
    const payload = makeValidReport();
    payload.trackCoverage.push({
      ...payload.trackCoverage[0],
      headings: [...payload.trackCoverage[0].headings],
    });

    const parsed = ReviewReportSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const messages = parsed.error.issues.map((issue) => issue.message);
      expect(messages.some((message) => message.includes("duplicate trackId"))).toBe(true);
    }
  });

  it("rejects invalid status literals such as HIGH", () => {
    const payload = makeValidReport() as unknown as {
      trackCoverage: Array<{
        headings: Array<{ status: string }>;
      }>;
    };
    payload.trackCoverage[0].headings[0].status = "HIGH";

    const parsed = ReviewReportSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const invalidStatusIssue = parsed.error.issues.find(
        (issue) =>
          issue.path.join(".").includes("trackCoverage.0.headings.0.status") &&
          issue.message.includes("Invalid enum value")
      );
      expect(invalidStatusIssue).toBeDefined();
    }
  });
});
