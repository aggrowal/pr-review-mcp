import { describe, it, expect } from "vitest";
import { buildPrompt } from "../src/skills/correctness/index.js";
import type { ChangedFile, DetectedContext, DiffContext } from "../src/types.js";

function makeDiff(files: ChangedFile[]): DiffContext {
  return {
    projectName: "demo",
    repoRoot: "/tmp/demo",
    baseBranch: "main",
    headBranch: "feature/correctness",
    repoUrl: "https://github.com/org/demo",
    files,
    totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
    totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
  };
}

function makeContext(fileCount: number): DetectedContext {
  return {
    language: "typescript",
    framework: ["react"],
    patterns: ["rest-api"],
    fileCount,
    primaryChangedAreas: ["api"],
  };
}

describe("correctness skill prompt", () => {
  it("includes expanded correctness taxonomy", () => {
    const diff = makeDiff([
      {
        path: "src/order/create.ts",
        status: "modified",
        additions: 3,
        deletions: 1,
        diff: "@@ -1,3 +1,5 @@\n export function createOrder() {\n+  return true;\n }\n",
      },
    ]);
    const ctx = makeContext(diff.files.length);

    const prompt = buildPrompt(diff, ctx);

    expect(prompt).toContain("## What to check");
    expect(prompt).toContain("Contract and Invariant Correctness");
    expect(prompt).toContain("Data Integrity and Mutation Safety");
    expect(prompt).toContain("Error and Failure Semantics");
    expect(prompt).toContain("Concurrency and Async Ordering");
    expect(prompt).toContain("Time and Idempotency Semantics");
    expect(prompt).toContain("Boundary, Numeric, and Unit Correctness");
    expect(prompt).toContain("API and Data-Shape Correctness");
    expect(prompt).toContain("Resource Lifecycle and Cleanup Correctness");
  });

  it("does not inline untrusted payload markers in track prompt", () => {
    const diff = makeDiff([
      {
        path: "src/auth/session.ts",
        status: "modified",
        additions: 4,
        deletions: 0,
        diff: "@@ -1,2 +1,3 @@\n export function issueToken() {\n+  return true;\n }\n",
      },
      {
        path: "src/legacy/deleted.ts",
        status: "deleted",
        additions: 0,
        deletions: 12,
        diff: "@@ -1,12 +0,0 @@\n-export const old = true;\n",
      },
    ]);
    const ctx = makeContext(diff.files.length);

    const prompt = buildPrompt(diff, ctx);

    expect(prompt).not.toContain("<<<UNTRUSTED_DIFF_BEGIN>>>");
    expect(prompt).not.toContain("<<<UNTRUSTED_DIFF_END>>>");
    expect(prompt).not.toContain("## Diff");
    expect(prompt).not.toContain("src/auth/session.ts");
  });

  it("requires concrete, non-style findings in rules", () => {
    const diff = makeDiff([
      {
        path: "src/cart/checkout.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        diff: "@@ -1,2 +1,3 @@\n export function checkout() {\n+  return true;\n }\n",
      },
    ]);
    const ctx = makeContext(diff.files.length);

    const prompt = buildPrompt(diff, ctx);

    expect(prompt).toContain("Only flag issues where the code is **demonstrably wrong**");
    expect(prompt).toContain("Do not flag style, naming, formatting, or refactor preferences.");
    expect(prompt).toContain("specific file and line range");
  });
});
