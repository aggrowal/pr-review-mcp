import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  readConfig,
  writeConfig,
  getProjectConfig,
  upsertProjectConfig,
  listProjects,
} from "../src/config.js";

let tmpDir: string;
let configPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pr-review-config-test-"));
  configPath = join(tmpDir, "config.json");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("readConfig", () => {
  it("returns default config when file does not exist", () => {
    const config = readConfig(configPath);
    expect(config.version).toBe(1);
    expect(config.projects).toEqual({});
    expect(config.reviewRuntime.maxValidationAttempts).toBe(3);
    expect(config.reviewRuntime.sessionTtlMinutes).toBe(30);
    expect(config.reviewRuntime.enrichment.enabled).toBe(false);
  });

  it("parses a valid config file", () => {
    writeConfig(
      {
        version: 1,
        projects: {
          myproject: {
            repoUrl: "https://github.com/org/myproject",
            mainBranch: "main",
          },
        },
      },
      configPath
    );

    const config = readConfig(configPath);
    expect(config.version).toBe(1);
    expect(config.projects["myproject"]).toBeDefined();
    expect(config.projects["myproject"].repoUrl).toBe(
      "https://github.com/org/myproject"
    );
    expect(config.reviewRuntime.maxValidationAttempts).toBe(3);
    expect(config.reviewRuntime.sessionTtlMinutes).toBe(30);
  });

  it("parses keyless review runtime settings when provided", () => {
    writeConfig(
      {
        version: 1,
        projects: {},
        reviewRuntime: {
          maxValidationAttempts: 4,
          sessionTtlMinutes: 45,
          enrichment: {
            enabled: true,
            provider: "git",
            maxCommits: 7,
          },
        },
      },
      configPath
    );

    const config = readConfig(configPath);
    expect(config.reviewRuntime.maxValidationAttempts).toBe(4);
    expect(config.reviewRuntime.sessionTtlMinutes).toBe(45);
    expect(config.reviewRuntime.enrichment.enabled).toBe(true);
    expect(config.reviewRuntime.enrichment.provider).toBe("git");
    expect(config.reviewRuntime.enrichment.maxCommits).toBe(7);
  });

  it("accepts legacy runtime keys for backward compatibility", () => {
    writeConfig(
      {
        version: 1,
        projects: {},
        reviewRuntime: {
          provider: "openai",
          executionMode: "provider_api",
          timeoutMs: 20000,
        } as unknown as Record<string, unknown>,
      },
      configPath
    );

    const config = readConfig(configPath);
    expect(config.reviewRuntime.maxValidationAttempts).toBe(3);
    expect(config.reviewRuntime.sessionTtlMinutes).toBe(30);
  });

  it("throws on malformed config", () => {
    const { writeFileSync } = require("fs");
    writeFileSync(configPath, "not json", "utf-8");
    expect(() => readConfig(configPath)).toThrow("malformed");
  });
});

describe("writeConfig", () => {
  it("creates config file and parent directory", () => {
    const nestedPath = join(tmpDir, "nested", "config.json");
    writeConfig(
      {
        version: 1,
        projects: {},
      },
      nestedPath
    );
    expect(existsSync(nestedPath)).toBe(true);
  });
});

describe("getProjectConfig", () => {
  it("returns null for non-existent project", () => {
    expect(getProjectConfig("nope", configPath)).toBeNull();
  });

  it("returns config for existing project", () => {
    upsertProjectConfig(
      "myproject",
      { repoUrl: "https://github.com/org/myproject", mainBranch: "main" },
      configPath
    );
    const pc = getProjectConfig("myproject", configPath);
    expect(pc).not.toBeNull();
    expect(pc!.mainBranch).toBe("main");
  });
});

describe("upsertProjectConfig", () => {
  it("adds a new project", () => {
    upsertProjectConfig(
      "alpha",
      { repoUrl: "https://github.com/org/alpha", mainBranch: "develop" },
      configPath
    );
    const projects = listProjects(configPath);
    expect(projects).toContain("alpha");
  });

  it("updates an existing project", () => {
    upsertProjectConfig(
      "alpha",
      { repoUrl: "https://github.com/org/alpha", mainBranch: "main" },
      configPath
    );
    upsertProjectConfig(
      "alpha",
      { repoUrl: "https://github.com/org/alpha", mainBranch: "develop" },
      configPath
    );
    const pc = getProjectConfig("alpha", configPath);
    expect(pc!.mainBranch).toBe("develop");
  });
});

describe("listProjects", () => {
  it("returns empty array when no projects", () => {
    expect(listProjects(configPath)).toEqual([]);
  });

  it("returns all project names", () => {
    upsertProjectConfig(
      "a",
      { repoUrl: "https://github.com/org/a", mainBranch: "main" },
      configPath
    );
    upsertProjectConfig(
      "b",
      { repoUrl: "https://github.com/org/b", mainBranch: "main" },
      configPath
    );
    const projects = listProjects(configPath);
    expect(projects).toContain("a");
    expect(projects).toContain("b");
    expect(projects).toHaveLength(2);
  });
});
