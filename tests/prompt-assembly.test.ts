import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { tmpdir } from "os";
import {
  createMockRepo,
  createBranch,
  addFiles,
  checkoutBranch,
  type MockRepo,
} from "./helpers/git-mock.js";
import { writeConfig } from "../src/config.js";
import { runProjectGuard } from "../src/tools/t1-project-guard.js";
import { runBranchResolver } from "../src/tools/t2-branch-resolver.js";
import { runDiffExtractor } from "../src/tools/t3-diff-extractor.js";
import { detectProjectContext, filterSkills } from "../src/orchestrator/detect.js";
import { createNullLogger } from "../src/logger.js";

import * as correctness from "../src/skills/correctness/index.js";
import * as securityGeneric from "../src/skills/security-generic/index.js";
import * as redundancy from "../src/skills/redundancy/index.js";

import type { SkillModule } from "../src/types.js";

const SKILL_REGISTRY: SkillModule[] = [correctness, securityGeneric, redundancy];
const logger = createNullLogger();

let repo: MockRepo;
let configDir: string;
let configPath: string;

beforeEach(() => {
  repo = createMockRepo();
  configDir = mkdtempSync(join(tmpdir(), "pr-review-integration-cfg-"));
  configPath = join(configDir, "config.json");

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
});

afterEach(() => {
  repo.cleanup();
  rmSync(configDir, { recursive: true, force: true });
});

describe("Full pipeline integration", () => {
  it("runs T1 -> T2 -> T3 -> detect -> filter -> prompt assembly", () => {
    // Set up a feature branch with TypeScript code
    createBranch(repo.path, "feature/auth");
    addFiles(repo.path, {
      "src/auth/login.ts": [
        'import { hash } from "bcrypt";',
        "",
        "export async function login(username: string, password: string) {",
        "  const user = await findUser(username);",
        "  if (!user) throw new Error('User not found');",
        "  const valid = await hash(password, user.passwordHash);",
        "  return { token: generateToken(user.id) };",
        "}",
        "",
      ].join("\n"),
      "src/auth/register.ts": [
        "export async function register(email: string, password: string) {",
        "  if (!email.includes('@')) throw new Error('Invalid email');",
        "  return createUser(email, password);",
        "}",
        "",
      ].join("\n"),
    });
    checkoutBranch(repo.path, "main");

    // T1: Project guard
    const guard = runProjectGuard(repo.path, logger, configPath);
    expect(guard.ok).toBe(true);
    if (!guard.ok) return;

    // T2: Branch resolver
    const branchResult = runBranchResolver(guard, "feature/auth", logger);
    expect(branchResult.ok).toBe(true);
    if (!branchResult.ok) return;

    // T3: Diff extractor
    const diffResult = runDiffExtractor(branchResult.context, logger);
    expect(diffResult.ok).toBe(true);
    if (!diffResult.ok) return;

    const diff = diffResult.diff;
    expect(diff.files.length).toBeGreaterThan(0);
    expect(diff.totalAdditions).toBeGreaterThan(0);

    // Orchestrator: detect
    const ctx = detectProjectContext(diff, logger);
    expect(ctx.language).toBe("typescript");
    expect(ctx.patterns).toContain("auth");
    expect(ctx.fileCount).toBe(2);

    // Orchestrator: filter skills
    const { matched, skipped } = filterSkills(
      ctx,
      SKILL_REGISTRY.map((s) => s.metadata),
      logger
    );

    // All three default skills are wildcard, should all match
    expect(matched).toHaveLength(3);
    expect(skipped).toHaveLength(0);

    // Build prompt for each matched skill
    const prompts = SKILL_REGISTRY.filter((s) =>
      matched.some((m) => m.id === s.metadata.id)
    ).map((s) => s.buildPrompt(diff, ctx));

    // Verify prompts contain the diff content
    for (const prompt of prompts) {
      expect(prompt).toContain("login.ts");
      expect(prompt).toContain("register.ts");
    }

    // Verify correctness prompt checks for the right things
    expect(prompts[0]).toContain("Logic errors");
    expect(prompts[0]).toContain("Null / undefined");

    // Verify security prompt checks for the right things
    expect(prompts[1]).toContain("Hardcoded secrets");
    expect(prompts[1]).toContain("Injection");

    // Verify redundancy prompt includes full file content
    expect(prompts[2]).toContain("Full file");
    expect(prompts[2]).toContain("Code duplication");
  });

  it("handles multi-language projects correctly", () => {
    createBranch(repo.path, "feature/mixed");
    addFiles(repo.path, {
      "backend/app.py": "from flask import Flask\napp = Flask(__name__)\n",
      "frontend/App.tsx": 'import React from "react";\nexport default function App() { return <div/>; }\n',
      "frontend/utils.ts": "export const add = (a: number, b: number) => a + b;\n",
    });
    checkoutBranch(repo.path, "main");

    const guard = runProjectGuard(repo.path, logger, configPath);
    if (!guard.ok) return;

    const branchResult = runBranchResolver(guard, "feature/mixed", logger);
    if (!branchResult.ok) return;

    const diffResult = runDiffExtractor(branchResult.context, logger);
    if (!diffResult.ok) return;

    const ctx = detectProjectContext(diffResult.diff, logger);
    // TypeScript has 2 files (.tsx + .ts), Python has 1 -- TS wins
    expect(ctx.language).toBe("typescript");
    expect(ctx.framework).toContain("react");
    expect(ctx.framework).toContain("flask");
  });

  it("returns error for unconfigured project", () => {
    const emptyConfigDir = mkdtempSync(join(tmpdir(), "pr-review-empty-cfg-"));
    const emptyConfigPath = join(emptyConfigDir, "config.json");
    writeConfig({ version: 1, projects: {} }, emptyConfigPath);

    try {
      const guard = runProjectGuard(repo.path, logger, emptyConfigPath);
      expect(guard.ok).toBe(false);
      if (!guard.ok) {
        expect(guard.reason).toContain("not configured");
      }
    } finally {
      rmSync(emptyConfigDir, { recursive: true, force: true });
    }
  });

  it("returns error for missing branch", () => {
    const guard = runProjectGuard(repo.path, logger, configPath);
    if (!guard.ok) return;

    const branchResult = runBranchResolver(guard, "feature/does-not-exist", logger);
    expect(branchResult.ok).toBe(false);
  });
});
