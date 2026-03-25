import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { z } from "zod";

// ---- Schema ----

export const ProjectConfigSchema = z.object({
  repoUrl: z.string().url(),
  mainBranch: z.string().default("main"),
});

export const ReviewRuntimeSchema = z.object({
  maxValidationAttempts: z.number().int().min(1).max(8).default(3),
  sessionTtlMinutes: z.number().int().min(5).max(240).default(30),
  enrichment: z
    .object({
      enabled: z.boolean().default(false),
      provider: z.enum(["git", "github"]).default("git"),
      maxCommits: z.number().int().min(1).max(20).default(5),
    })
    .default({}),
  tokenBudget: z
    .object({
      maxPromptChars: z
        .number()
        .int()
        .positive()
        .default(400_000),
      maxFiles: z.number().int().positive().default(100),
      maxTotalLines: z.number().int().positive().default(15_000),
    })
    .default({}),
}).passthrough();

export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  projects: z.record(z.string(), ProjectConfigSchema).default({}),
  logLevel: z.enum(["debug", "info", "warn", "error"]).optional(),
  logFile: z.union([z.boolean(), z.string()]).optional(),
  reviewRuntime: ReviewRuntimeSchema.default({}),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type ReviewRuntimeConfig = z.infer<typeof ReviewRuntimeSchema>;
export type Config = z.infer<typeof ConfigSchema>;

// ---- Paths ----

const CONFIG_DIR = join(homedir(), ".pr-review-mcp");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

// ---- Read / Write ----

export function readConfig(configPath?: string): Config {
  const filePath = configPath ?? CONFIG_FILE;
  if (!existsSync(filePath)) {
    return ConfigSchema.parse({});
  }
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8"));
    return ConfigSchema.parse(raw);
  } catch {
    throw new Error(
      `Config at ${filePath} is malformed. Fix or delete it and reconfigure.`
    );
  }
}

export function writeConfig(config: Config, configPath?: string): void {
  const filePath = configPath ?? CONFIG_FILE;
  const dir = filePath === CONFIG_FILE ? CONFIG_DIR : join(filePath, "..");
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
}

// ---- Helpers ----

export function getProjectConfig(
  projectName: string,
  configPath?: string
): ProjectConfig | null {
  const config = readConfig(configPath);
  return config.projects[projectName] ?? null;
}

export function upsertProjectConfig(
  projectName: string,
  projectConfig: ProjectConfig,
  configPath?: string
): void {
  const config = readConfig(configPath);
  config.projects[projectName] = projectConfig;
  writeConfig(config, configPath);
}

export function listProjects(configPath?: string): string[] {
  return Object.keys(readConfig(configPath).projects);
}

export function configFilePath(): string {
  return CONFIG_FILE;
}
