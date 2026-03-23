import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { basename } from "path";
import {
  createMockRepo,
  createBranch,
  addFiles,
  checkoutBranch,
  type MockRepo,
} from "./helpers/git-mock.js";
import { runDiffExtractor } from "../src/tools/t3-diff-extractor.js";
import type { BranchContext } from "../src/types.js";
import { createNullLogger } from "../src/logger.js";

const logger = createNullLogger();

let repo: MockRepo;

function makeContext(overrides?: Partial<BranchContext>): BranchContext {
  return {
    projectName: basename(repo.path),
    repoRoot: repo.path,
    baseBranch: "main",
    headBranch: "feature/test",
    repoUrl: "https://github.com/org/test",
    ...overrides,
  };
}

beforeEach(() => {
  repo = createMockRepo();
});

afterEach(() => {
  repo.cleanup();
});

describe("runDiffExtractor", () => {
  it("extracts added files", () => {
    createBranch(repo.path, "feature/test");
    addFiles(repo.path, {
      "src/hello.ts": 'export function hello() {\n  return "world";\n}\n',
    });
    checkoutBranch(repo.path, "main");

    const result = runDiffExtractor(makeContext(), logger);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diff.files).toHaveLength(1);
      expect(result.diff.files[0].path).toBe("src/hello.ts");
      expect(result.diff.files[0].status).toBe("added");
      expect(result.diff.files[0].additions).toBeGreaterThan(0);
      expect(result.diff.files[0].diff).toContain("hello");
    }
  });

  it("extracts modified files", () => {
    addFiles(repo.path, {
      "src/app.ts": "export const version = 1;\n",
    });

    createBranch(repo.path, "feature/test");
    addFiles(repo.path, {
      "src/app.ts": "export const version = 2;\n",
    });
    checkoutBranch(repo.path, "main");

    const result = runDiffExtractor(makeContext(), logger);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diff.files).toHaveLength(1);
      expect(result.diff.files[0].status).toBe("modified");
      expect(result.diff.files[0].additions).toBeGreaterThanOrEqual(1);
      expect(result.diff.files[0].deletions).toBeGreaterThanOrEqual(1);
    }
  });

  it("extracts deleted files", () => {
    addFiles(repo.path, { "old.txt": "will be deleted\n" });

    createBranch(repo.path, "feature/test");
    const { execSync } = require("child_process");
    execSync("git rm old.txt", { cwd: repo.path, stdio: "pipe" });
    execSync('git commit -m "delete old.txt"', {
      cwd: repo.path,
      stdio: "pipe",
    });
    checkoutBranch(repo.path, "main");

    const result = runDiffExtractor(makeContext(), logger);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const deleted = result.diff.files.find((f) => f.path === "old.txt");
      expect(deleted).toBeDefined();
      expect(deleted!.status).toBe("deleted");
      expect(deleted!.content).toBeUndefined();
    }
  });

  it("computes correct totals", () => {
    createBranch(repo.path, "feature/test");
    addFiles(repo.path, {
      "a.ts": "line1\nline2\nline3\n",
      "b.ts": "alpha\nbeta\n",
    });
    checkoutBranch(repo.path, "main");

    const result = runDiffExtractor(makeContext(), logger);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diff.totalAdditions).toBe(
        result.diff.files.reduce((s, f) => s + f.additions, 0)
      );
      expect(result.diff.totalDeletions).toBe(
        result.diff.files.reduce((s, f) => s + f.deletions, 0)
      );
    }
  });

  it("fails when branches have no common ancestor", () => {
    const result = runDiffExtractor(
      makeContext({ headBranch: "orphan-branch" }),
      logger
    );
    expect(result.ok).toBe(false);
  });

  it("fails when no differences exist", () => {
    createBranch(repo.path, "feature/test");
    checkoutBranch(repo.path, "main");

    const result = runDiffExtractor(makeContext(), logger);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("No differences");
    }
  });

  it("includes full file content for non-deleted files", () => {
    createBranch(repo.path, "feature/test");
    const content = 'export function greet(name: string) {\n  return `Hello ${name}`;\n}\n';
    addFiles(repo.path, { "greet.ts": content });
    // Stay on the feature branch so the file exists on disk
    // But the extractor should still work from main via git show fallback
    checkoutBranch(repo.path, "main");

    const result = runDiffExtractor(makeContext(), logger);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const file = result.diff.files.find((f) => f.path === "greet.ts");
      expect(file).toBeDefined();
      expect(file!.content).toBeDefined();
      expect(file!.content).toContain("greet");
    }
  });
});
