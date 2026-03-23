import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { basename } from "path";
import {
  createMockRepo,
  createBranch,
  addFiles,
  checkoutBranch,
  type MockRepo,
} from "./helpers/git-mock.js";
import { runBranchResolver } from "../src/tools/t2-branch-resolver.js";
import type { ProjectGuardOk } from "../src/tools/t1-project-guard.js";
import { createNullLogger } from "../src/logger.js";

const logger = createNullLogger();

let repo: MockRepo;
let guard: ProjectGuardOk;

beforeEach(() => {
  repo = createMockRepo();
  guard = {
    ok: true,
    repoRoot: repo.path,
    projectName: basename(repo.path),
    mainBranch: "main",
    repoUrl: "https://github.com/org/test",
  };
});

afterEach(() => {
  repo.cleanup();
});

describe("runBranchResolver", () => {
  it("fails when no branch name provided", () => {
    const result = runBranchResolver(guard, undefined, logger);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("No branch name");
    }
  });

  it("fails when branch name is empty string", () => {
    const result = runBranchResolver(guard, "  ", logger);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("No branch name");
    }
  });

  it("fails when branch does not exist locally", () => {
    const result = runBranchResolver(guard, "feature/nonexistent", logger);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("not found");
    }
  });

  it("suggests similar branch names on mismatch", () => {
    createBranch(repo.path, "feature/login");
    addFiles(repo.path, { "login.ts": "export {};" });
    checkoutBranch(repo.path, "main");

    const result = runBranchResolver(guard, "feature/logn", logger);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.hint).toContain("feature/login");
    }
  });

  it("fails when head branch equals base branch", () => {
    const result = runBranchResolver(guard, "main", logger);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("nothing to compare");
    }
  });

  it("succeeds with a valid feature branch", () => {
    createBranch(repo.path, "feature/auth");
    addFiles(repo.path, { "auth.ts": "export function login() {}" });
    checkoutBranch(repo.path, "main");

    const result = runBranchResolver(guard, "feature/auth", logger);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.headBranch).toBe("feature/auth");
      expect(result.context.baseBranch).toBe("main");
      expect(result.context.projectName).toBe(guard.projectName);
    }
  });
});
