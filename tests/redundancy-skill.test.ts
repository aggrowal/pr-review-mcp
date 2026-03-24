import { describe, it, expect } from "vitest";
import { buildPrompt } from "../src/skills/redundancy/index.js";
import type { ChangedFile, DetectedContext, DiffContext } from "../src/types.js";

function makeDiff(files: ChangedFile[]): DiffContext {
  return {
    projectName: "demo",
    repoRoot: "/tmp/demo",
    baseBranch: "main",
    headBranch: "feature/redundancy",
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
    patterns: ["frontend-ui"],
    fileCount,
    primaryChangedAreas: ["components"],
  };
}

describe("redundancy skill prompt", () => {
  it("includes deep multi-section redundancy taxonomy", () => {
    const diff = makeDiff([
      {
        path: "src/components/Widget.tsx",
        status: "modified",
        additions: 5,
        deletions: 2,
        diff: "@@ -1,4 +1,7 @@\n export function Widget() {}\n",
      },
    ]);
    const ctx = makeContext(diff.files.length);

    const prompt = buildPrompt(diff, ctx);

    expect(prompt).toContain("Duplicate Logic and Near-Duplicates");
    expect(prompt).toContain("Dead and Unreachable Code");
    expect(prompt).toContain("Import/Dependency Redundancy");
    expect(prompt).toContain("Redundant Computation and Data Movement");
    expect(prompt).toContain("Premature Abstraction and Over-Engineering");
    expect(prompt).toContain("Reinvented Utilities");
    expect(prompt).toContain("Debug and Review Noise");
  });

  it("enforces concrete anti-noise guidance", () => {
    const diff = makeDiff([
      {
        path: "src/service.ts",
        status: "modified",
        additions: 2,
        deletions: 1,
        diff: "@@ -1,3 +1,4 @@\n export const run = () => true;\n",
      },
    ]);
    const ctx = makeContext(diff.files.length);

    const prompt = buildPrompt(diff, ctx);

    expect(prompt).toContain("cite both locations");
    expect(prompt).toContain("intentional repetition");
    expect(prompt).toContain("concrete cleanup suggestions");
  });

  it("does not inline shared payload markers or file content", () => {
    const diff = makeDiff([
      {
        path: "src/legacy.ts",
        status: "modified",
        additions: 3,
        deletions: 0,
        diff: "@@ -1,1 +1,4 @@\n+console.log('debug');\n",
        content: "console.log('debug');",
      },
    ]);
    const ctx = makeContext(diff.files.length);

    const prompt = buildPrompt(diff, ctx);

    expect(prompt).not.toContain("<<<UNTRUSTED_DIFF_BEGIN>>>");
    expect(prompt).not.toContain("## Changed files");
    expect(prompt).not.toContain("Full file");
    expect(prompt).not.toContain("src/legacy.ts");
  });
});
