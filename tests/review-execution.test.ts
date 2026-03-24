import { describe, expect, it } from "vitest";
import {
  executeReview,
  ReviewExecutionError,
} from "../src/review/execute-review.js";
import {
  LlmProviderError,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from "../src/llm/provider.js";
import { createNullLogger } from "../src/logger.js";
import type { TrackExecutionContract } from "../src/prompt/assemble.js";

class MockProvider implements LlmProvider {
  readonly id = "openai" as const;
  readonly model = "mock-model";
  readonly calls: LlmRequest[] = [];
  private queue: Array<string | Error>;

  constructor(queue: Array<string | Error>) {
    this.queue = [...queue];
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request);
    const next = this.queue.shift();
    if (next instanceof Error) {
      throw next;
    }
    if (typeof next !== "string") {
      throw new Error("MockProvider queue exhausted");
    }
    return {
      provider: this.id,
      model: this.model,
      text: next,
    };
  }
}

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

describe("executeReview", () => {
  it("returns validated report on first valid output", async () => {
    const provider = new MockProvider([makeValidReportJson()]);
    const result = await executeReview({
      assembledPrompt: "Assembled prompt body",
      trackContracts: makeTrackContracts(),
      logger: createNullLogger(),
      provider,
      maxRetries: 1,
    });

    expect(result.attempts).toBe(1);
    expect(result.report.verdict).toBe("NEEDS_DISCUSSION");
    expect(provider.calls).toHaveLength(1);
  });

  it("retries once when first output is invalid", async () => {
    const provider = new MockProvider(["not-json", makeValidReportJson()]);

    const result = await executeReview({
      assembledPrompt: "Assembled prompt body",
      trackContracts: makeTrackContracts(),
      logger: createNullLogger(),
      provider,
      maxRetries: 1,
    });

    expect(result.attempts).toBe(2);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].prompt).toContain("## Output correction required");
  });

  it("throws when output is still invalid after retries", async () => {
    const provider = new MockProvider(["still not json"]);

    await expect(
      executeReview({
        assembledPrompt: "Assembled prompt body",
        trackContracts: makeTrackContracts(),
        logger: createNullLogger(),
        provider,
        maxRetries: 0,
      })
    ).rejects.toMatchObject({
      name: "ReviewExecutionError",
      code: "invalid_output",
    } as Partial<ReviewExecutionError>);
  });

  it("retries on retryable provider errors", async () => {
    const provider = new MockProvider([
      new LlmProviderError("timeout", "timed out", { retryable: true }),
      makeValidReportJson(),
    ]);

    const result = await executeReview({
      assembledPrompt: "Assembled prompt body",
      trackContracts: makeTrackContracts(),
      logger: createNullLogger(),
      provider,
      maxRetries: 1,
    });

    expect(result.attempts).toBe(2);
    expect(provider.calls).toHaveLength(2);
  });
});
