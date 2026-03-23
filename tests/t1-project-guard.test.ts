import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { tmpdir } from "os";
import { createMockRepo, type MockRepo } from "./helpers/git-mock.js";
import { runProjectGuard } from "../src/tools/t1-project-guard.js";
import { writeConfig } from "../src/config.js";
import { createNullLogger } from "../src/logger.js";

const logger = createNullLogger();

let repo: MockRepo;
let configPath: string;
let configDir: string;

beforeEach(() => {
  repo = createMockRepo();
  configDir = mkdtempSync(join(tmpdir(), "pr-review-guard-cfg-"));
  configPath = join(configDir, "config.json");
});

afterEach(() => {
  repo.cleanup();
  rmSync(configDir, { recursive: true, force: true });
});

describe("runProjectGuard", () => {
  it("succeeds when project is configured", () => {
    const projectName = basename(repo.path);
    writeConfig(
      {
        version: 1,
        projects: {
          [projectName]: {
            repoUrl: "https://github.com/org/test",
            mainBranch: "main",
          },
        },
      },
      configPath
    );

    const result = runProjectGuard(repo.path, logger, configPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projectName).toBe(projectName);
      expect(result.mainBranch).toBe("main");
      expect(result.repoUrl).toBe("https://github.com/org/test");
    }
  });

  it("fails when not in a git repo", () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), "pr-review-no-git-"));
    try {
      const result = runProjectGuard(nonGitDir, logger, configPath);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("git repository");
      }
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it("fails when project is not configured", () => {
    writeConfig({ version: 1, projects: {} }, configPath);

    const result = runProjectGuard(repo.path, logger, configPath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("not configured");
      expect(result.hint).toContain("configure_project");
    }
  });

  it("works from a subdirectory of the repo", () => {
    const projectName = basename(repo.path);
    writeConfig(
      {
        version: 1,
        projects: {
          [projectName]: {
            repoUrl: "https://github.com/org/test",
            mainBranch: "develop",
          },
        },
      },
      configPath
    );

    const subDir = join(repo.path, "subdir");
    mkdirSync(subDir, { recursive: true });

    const result = runProjectGuard(subDir, logger, configPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projectName).toBe(projectName);
      expect(result.mainBranch).toBe("develop");
    }
  });
});
