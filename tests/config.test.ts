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
    expect(config.reviewRuntime.provider).toBe("anthropic");
    expect(config.reviewRuntime.timeoutMs).toBe(45000);
    expect(config.reviewRuntime.maxRetries).toBe(1);
    expect(config.reviewRuntime.executionMode).toBe("auto");
    expect(config.reviewRuntime.samplingIncludeContext).toBe("none");
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
    expect(config.reviewRuntime.provider).toBe("anthropic");
  });

  it("parses review runtime settings when provided", () => {
    writeConfig(
      {
        version: 1,
        projects: {},
        reviewRuntime: {
          provider: "openai",
          model: "gpt-4.1",
          timeoutMs: 30000,
          maxRetries: 2,
          maxOutputTokens: 4096,
          temperature: 0.2,
          executionMode: "client_sampling",
          samplingIncludeContext: "thisServer",
          samplingModelHint: "claude",
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
    expect(config.reviewRuntime.provider).toBe("openai");
    expect(config.reviewRuntime.model).toBe("gpt-4.1");
    expect(config.reviewRuntime.timeoutMs).toBe(30000);
    expect(config.reviewRuntime.maxRetries).toBe(2);
    expect(config.reviewRuntime.maxOutputTokens).toBe(4096);
    expect(config.reviewRuntime.temperature).toBe(0.2);
    expect(config.reviewRuntime.executionMode).toBe("client_sampling");
    expect(config.reviewRuntime.samplingIncludeContext).toBe("thisServer");
    expect(config.reviewRuntime.samplingModelHint).toBe("claude");
    expect(config.reviewRuntime.enrichment.enabled).toBe(true);
    expect(config.reviewRuntime.enrichment.provider).toBe("git");
    expect(config.reviewRuntime.enrichment.maxCommits).toBe(7);
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
