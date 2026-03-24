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

    // Build prompt for each matched skill, keyed by id for position-independence
    const promptMap = new Map<string, string>();
    for (const s of SKILL_REGISTRY) {
      if (matched.some((m) => m.id === s.metadata.id)) {
        promptMap.set(s.metadata.id, s.buildPrompt(diff, ctx));
      }
    }

    // Verify all prompts contain the diff content
    for (const prompt of promptMap.values()) {
      expect(prompt).toContain("login.ts");
      expect(prompt).toContain("register.ts");
    }

    // Verify correctness prompt covers expanded practical taxonomy
    const correctnessPrompt = promptMap.get("correctness")!;
    expect(correctnessPrompt).toContain("Contract and Invariant Correctness");
    expect(correctnessPrompt).toContain("Data Integrity and Mutation Safety");
    expect(correctnessPrompt).toContain("Error and Failure Semantics");
    expect(correctnessPrompt).toContain("Time and Idempotency Semantics");
    expect(correctnessPrompt).toContain("API and Data-Shape Correctness");
    expect(correctnessPrompt).toContain("Resource Lifecycle and Cleanup Correctness");

    // Verify correctness anti-noise guardrails
    expect(correctnessPrompt).toContain("concrete failure scenario");
    expect(correctnessPrompt).toContain("Do not flag style, naming, formatting, or refactor preferences.");
    expect(correctnessPrompt).toContain("Untrusted content policy");

    // Verify security prompt covers expanded checklist categories
    const securityPrompt = promptMap.get("security-generic")!;
    expect(securityPrompt).toContain("Hardcoded secrets");
    expect(securityPrompt).toContain("Injection");
    expect(securityPrompt).toContain("BOLA / IDOR");
    expect(securityPrompt).toContain("SSRF");
    expect(securityPrompt).toContain("Connection and handle leaks");
    expect(securityPrompt).toContain("Unsafe deserialization");
    expect(securityPrompt).toContain("JWT and self-contained token");
    expect(securityPrompt).toContain("Vulnerable or untrusted dependencies");

    // Verify security prompt has untrusted-content hardening
    expect(securityPrompt).toContain("<<<UNTRUSTED_DIFF_BEGIN>>>");
    expect(securityPrompt).toContain("<<<UNTRUSTED_DIFF_END>>>");
    expect(securityPrompt).toContain("Untrusted content policy");

    // Verify all skills use untrusted sentinels (hardening applied across tracks)
    expect(correctnessPrompt).toContain("<<<UNTRUSTED_DIFF_BEGIN>>>");
    const redundancyPrompt = promptMap.get("redundancy")!;
    expect(redundancyPrompt).toContain("<<<UNTRUSTED_DIFF_BEGIN>>>");

    // Verify redundancy prompt includes full file content
    expect(redundancyPrompt).toContain("Full file");
    expect(redundancyPrompt).toContain("Code duplication");
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
