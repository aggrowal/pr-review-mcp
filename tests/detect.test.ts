import { describe, it, expect } from "vitest";
import {
  detectProjectContext,
  filterSkills,
} from "../src/orchestrator/detect.js";
import type {
  DiffContext,
  ChangedFile,
  SkillMetadata,
} from "../src/types.js";
import { createNullLogger } from "../src/logger.js";

const logger = createNullLogger();

function makeDiff(
  files: Partial<ChangedFile>[],
  overrides?: Partial<DiffContext>
): DiffContext {
  const fullFiles: ChangedFile[] = files.map((f) => ({
    path: f.path ?? "unknown",
    status: f.status ?? "modified",
    additions: f.additions ?? 1,
    deletions: f.deletions ?? 0,
    diff: f.diff ?? "",
    content: f.content,
    ...f,
  }));

  return {
    projectName: "test",
    repoRoot: "/tmp/test",
    baseBranch: "main",
    headBranch: "feature/test",
    repoUrl: "https://github.com/org/test",
    files: fullFiles,
    totalAdditions: fullFiles.reduce((s, f) => s + f.additions, 0),
    totalDeletions: fullFiles.reduce((s, f) => s + f.deletions, 0),
    ...overrides,
  };
}

describe("detectProjectContext", () => {
  describe("language detection", () => {
    it("detects typescript from .ts files", () => {
      const diff = makeDiff([
        { path: "src/app.ts" },
        { path: "src/utils.ts" },
        { path: "src/types.ts" },
      ]);
      const ctx = detectProjectContext(diff, logger);
      expect(ctx.language).toBe("typescript");
    });

    it("detects python from .py files", () => {
      const diff = makeDiff([
        { path: "app/main.py" },
        { path: "app/models.py" },
      ]);
      const ctx = detectProjectContext(diff, logger);
      expect(ctx.language).toBe("python");
    });

    it("detects java from .java files", () => {
      const diff = makeDiff([
        { path: "src/Main.java" },
        { path: "src/Service.java" },
      ]);
      const ctx = detectProjectContext(diff, logger);
      expect(ctx.language).toBe("java");
    });

    it("detects go from .go files", () => {
      const diff = makeDiff([
        { path: "cmd/server/main.go" },
        { path: "internal/handler.go" },
      ]);
      const ctx = detectProjectContext(diff, logger);
      expect(ctx.language).toBe("go");
    });

    it("picks the most frequent language in mixed projects", () => {
      const diff = makeDiff([
        { path: "src/a.ts" },
        { path: "src/b.ts" },
        { path: "src/c.ts" },
        { path: "config.py" },
      ]);
      const ctx = detectProjectContext(diff, logger);
      expect(ctx.language).toBe("typescript");
    });

    it("returns unknown for non-code files", () => {
      const diff = makeDiff([
        { path: "docs/readme.md" },
        { path: "data/config.yaml" },
      ]);
      const ctx = detectProjectContext(diff, logger);
      expect(ctx.language).toBe("unknown");
    });
  });

  describe("framework detection", () => {
    it("detects react from import statements", () => {
      const diff = makeDiff([
        {
          path: "src/App.tsx",
          content: 'import React from "react";\nimport { useState } from "react";',
        },
      ]);
      const ctx = detectProjectContext(diff, logger);
      expect(ctx.framework).toContain("react");
    });

    it("detects nextjs from next.config file", () => {
      const diff = makeDiff([{ path: "next.config.js" }]);
      const ctx = detectProjectContext(diff, logger);
      expect(ctx.framework).toContain("nextjs");
    });

    it("detects spring-boot from annotations", () => {
      const diff = makeDiff([
        {
          path: "src/App.java",
          content: "@SpringBootApplication\npublic class App {}",
        },
      ]);
      const ctx = detectProjectContext(diff, logger);
      expect(ctx.framework).toContain("spring-boot");
    });

    it("detects django from manage.py", () => {
      const diff = makeDiff([{ path: "manage.py" }]);
      const ctx = detectProjectContext(diff, logger);
      expect(ctx.framework).toContain("django");
    });

    it("detects express from require statements", () => {
      const diff = makeDiff([
        {
          path: "src/server.js",
          content: 'const express = require("express");\nconst app = express();',
        },
      ]);
      const ctx = detectProjectContext(diff, logger);
      expect(ctx.framework).toContain("express");
    });

    it("returns empty array when no framework detected", () => {
      const diff = makeDiff([{ path: "src/utils.ts", content: "export const x = 1;" }]);
      const ctx = detectProjectContext(diff, logger);
      expect(ctx.framework).toEqual([]);
    });
  });

  describe("pattern detection", () => {
    it("detects rest-api from route definitions", () => {
      const diff = makeDiff([
        {
          path: "src/routes/users.ts",
          content: 'router.get("/users", handler);',
        },
      ]);
      const ctx = detectProjectContext(diff, logger);
      expect(ctx.patterns).toContain("rest-api");
    });

    it("detects database from SQL in content", () => {
      const diff = makeDiff([
        {
          path: "src/repo.ts",
          content: 'const result = db.query("SELECT * FROM users WHERE id = $1");',
        },
      ]);
      const ctx = detectProjectContext(diff, logger);
      expect(ctx.patterns).toContain("database");
    });

    it("detects auth from file paths", () => {
      const diff = makeDiff([{ path: "src/auth/login.ts" }]);
      const ctx = detectProjectContext(diff, logger);
      expect(ctx.patterns).toContain("auth");
    });

    it("detects testing from test files", () => {
      const diff = makeDiff([
        {
          path: "src/utils.test.ts",
          content: 'describe("utils", () => { it("works", () => { expect(1).toBe(1); }); });',
        },
      ]);
      const ctx = detectProjectContext(diff, logger);
      expect(ctx.patterns).toContain("testing");
    });
  });

  describe("primaryChangedAreas", () => {
    it("extracts areas from directory structure", () => {
      const diff = makeDiff([
        { path: "src/auth/login.ts" },
        { path: "src/auth/register.ts" },
        { path: "src/payments/checkout.ts" },
      ]);
      const ctx = detectProjectContext(diff, logger);
      expect(ctx.primaryChangedAreas).toContain("auth");
      expect(ctx.primaryChangedAreas).toContain("payments");
    });

    it("skips common top-level dirs like src/", () => {
      const diff = makeDiff([
        { path: "src/handlers/api.ts" },
      ]);
      const ctx = detectProjectContext(diff, logger);
      expect(ctx.primaryChangedAreas).not.toContain("src");
      expect(ctx.primaryChangedAreas).toContain("handlers");
    });
  });

  it("sets fileCount correctly", () => {
    const diff = makeDiff([
      { path: "a.ts" },
      { path: "b.ts" },
      { path: "c.ts" },
    ]);
    const ctx = detectProjectContext(diff, logger);
    expect(ctx.fileCount).toBe(3);
  });
});

describe("filterSkills", () => {
  const wildcardSkill: SkillMetadata = {
    id: "all",
    name: "All",
    description: "runs on everything",
    requires: { language: ["*"], framework: ["*"] },
    produces: "all",
  };

  const javaOnlySkill: SkillMetadata = {
    id: "java-only",
    name: "Java Only",
    description: "only for java",
    requires: { language: ["java"] },
    produces: "java-check",
  };

  const springSkill: SkillMetadata = {
    id: "spring",
    name: "Spring",
    description: "spring-boot specific",
    requires: { language: ["java", "kotlin"], framework: ["spring-boot"] },
    produces: "spring-check",
  };

  it("matches wildcard skills against any context", () => {
    const ctx = detectProjectContext(makeDiff([{ path: "a.rs" }]), logger);
    const result = filterSkills(ctx, [wildcardSkill], logger);
    expect(result.matched).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it("skips language-specific skills that do not match", () => {
    const ctx = detectProjectContext(makeDiff([{ path: "a.ts" }]), logger);
    const result = filterSkills(ctx, [javaOnlySkill], logger);
    expect(result.matched).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain("language");
  });

  it("matches language-specific skills when language matches", () => {
    const ctx = detectProjectContext(makeDiff([{ path: "App.java" }]), logger);
    const result = filterSkills(ctx, [javaOnlySkill], logger);
    expect(result.matched).toHaveLength(1);
  });

  it("requires all specified fields to match (AND logic)", () => {
    const ctx = detectProjectContext(
      makeDiff([{ path: "App.java", content: "public class App {}" }]),
      logger
    );
    const result = filterSkills(ctx, [springSkill], logger);
    expect(result.matched).toHaveLength(0);
    expect(result.skipped[0].reason).toContain("framework");
  });

  it("matches when all required fields match", () => {
    const ctx = detectProjectContext(
      makeDiff([
        {
          path: "App.java",
          content: "@SpringBootApplication\npublic class App {}",
        },
      ]),
      logger
    );
    const result = filterSkills(ctx, [springSkill], logger);
    expect(result.matched).toHaveLength(1);
  });

  it("supports OR within a field (language: java OR kotlin)", () => {
    const ctx = detectProjectContext(
      makeDiff([
        {
          path: "App.kt",
          content: "@SpringBootApplication\nclass App",
        },
      ]),
      logger
    );
    const result = filterSkills(ctx, [springSkill], logger);
    expect(result.matched).toHaveLength(1);
  });
});
