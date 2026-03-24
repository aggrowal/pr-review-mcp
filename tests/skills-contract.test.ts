import { describe, it, expect } from "vitest";
import { SKILL_REGISTRY } from "../src/skills/registry.js";
import type { DiffContext, DetectedContext } from "../src/types.js";

function makeDiff(): DiffContext {
  return {
    projectName: "demo",
    repoRoot: "/tmp/demo",
    baseBranch: "main",
    headBranch: "feature/skills",
    repoUrl: "https://github.com/org/demo",
    files: [
      {
        path: "src/api/users.ts",
        status: "modified",
        additions: 5,
        deletions: 1,
        diff: "@@ -1,2 +1,6 @@\n+export const token = '<<<UNTRUSTED_DIFF_BEGIN>>>';\n",
        content: "export const token = '<<<UNTRUSTED_DIFF_END>>>';\n",
      },
    ],
    totalAdditions: 5,
    totalDeletions: 1,
  };
}

function makeContext(): DetectedContext {
  return {
    language: "typescript",
    framework: ["react"],
    patterns: ["rest-api", "frontend-ui"],
    fileCount: 1,
    primaryChangedAreas: ["api"],
  };
}

function parsePromptHeadingsAndChecks(prompt: string): {
  headingCount: number;
  headingsWithoutChecks: string[];
  checkCount: number;
} {
  const lines = prompt.split("\n");
  const headingCheckCounts = new Map<string, number>();
  let currentHeading: string | null = null;
  let checkCount = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const headingMatch = /^###\s+([A-Z])\.\s+(.+)$/.exec(line);
    if (headingMatch) {
      currentHeading = `${headingMatch[1]}. ${headingMatch[2]}`;
      headingCheckCounts.set(currentHeading, 0);
      continue;
    }

    const checkMatch = /^([0-9]+)\.\s+/.exec(line);
    if (checkMatch && currentHeading) {
      headingCheckCounts.set(
        currentHeading,
        (headingCheckCounts.get(currentHeading) ?? 0) + 1
      );
      checkCount += 1;
    }
  }

  const headingsWithoutChecks = [...headingCheckCounts.entries()]
    .filter(([, count]) => count === 0)
    .map(([heading]) => heading);

  return {
    headingCount: headingCheckCounts.size,
    headingsWithoutChecks,
    checkCount,
  };
}

describe("skill prompt contract", () => {
  it("registers the expected 10 review tracks", () => {
    const ids = SKILL_REGISTRY.map((s) => s.metadata.id);
    expect(ids).toEqual([
      "correctness",
      "security-generic",
      "redundancy",
      "performance-scalability",
      "reliability-resilience",
      "api-contract-compatibility",
      "testing-quality",
      "observability-operability",
      "maintainability-design",
      "accessibility-i18n",
    ]);
  });

  it("ensures each skill prompt stays checklist/rules focused without inline payload", () => {
    const diff = makeDiff();
    const ctx = makeContext();

    for (const skill of SKILL_REGISTRY) {
      const prompt = skill.buildPrompt(diff, ctx);

      expect(prompt).toContain("## What to check");
      expect(prompt).toContain("## Rules");
      expect(prompt).not.toContain("<<<UNTRUSTED_DIFF_BEGIN>>>");
      expect(prompt).not.toContain("<<<UNTRUSTED_DIFF_END>>>");
      expect(prompt).not.toContain("## Diff");
      expect(prompt).not.toContain("#### Diff");
      expect(prompt).not.toContain("src/api/users.ts");
    }
  });

  it("ensures each skill prompt is parseable into headings and numbered checks", () => {
    const diff = makeDiff();
    const ctx = makeContext();

    for (const skill of SKILL_REGISTRY) {
      const prompt = skill.buildPrompt(diff, ctx);
      const parsed = parsePromptHeadingsAndChecks(prompt);

      expect(parsed.headingCount).toBeGreaterThan(0);
      expect(parsed.checkCount).toBeGreaterThan(0);
      expect(parsed.headingsWithoutChecks).toEqual([]);
    }
  });
});
