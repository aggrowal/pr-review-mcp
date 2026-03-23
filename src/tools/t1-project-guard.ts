import { execSync } from "child_process";
import { basename } from "path";
import { getProjectConfig } from "../config.js";
import type { Logger } from "../logger.js";

export interface ProjectGuardOk {
  ok: true;
  repoRoot: string;
  projectName: string;
  mainBranch: string;
  repoUrl: string;
}

export interface ProjectGuardError {
  ok: false;
  reason: string;
  hint: string;
  detail?: string;
}

export type ProjectGuardResult = ProjectGuardOk | ProjectGuardError;

/**
 * T1 -- Project Guard
 *
 * Validates that the working directory is inside a git repo whose folder name
 * matches a configured project. Fails fast with actionable hints on any mismatch.
 */
export function runProjectGuard(
  cwd: string,
  logger: Logger,
  configPath?: string
): ProjectGuardResult {
  let repoRoot: string;
  const gitCmd = "git rev-parse --show-toplevel";
  logger.debug(`T1: running "${gitCmd}"`, { cwd });
  try {
    repoRoot = execSync(gitCmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (e) {
    const stderr = e instanceof Error ? (e as any).stderr?.toString?.() ?? String(e) : String(e);
    logger.error("T1: git rev-parse failed", { cwd, stderr });
    return {
      ok: false,
      reason: "Not inside a git repository.",
      hint:
        "Navigate to a git repository directory, or initialize one with: git init",
      detail: `Command "${gitCmd}" failed in ${cwd}: ${stderr}`,
    };
  }

  logger.debug("T1: repo root resolved", { repoRoot });

  const projectName = basename(repoRoot);
  logger.debug("T1: looking up project config", { projectName, configPath });

  const projectConfig = getProjectConfig(projectName, configPath);
  if (!projectConfig) {
    logger.error("T1: project not configured", { projectName });
    return {
      ok: false,
      reason: `Project "${projectName}" is not configured.`,
      hint:
        `Run configure_project with name: "${projectName}" to register this project.\n` +
        `The project name must match the git repo folder name exactly.`,
      detail: `Looked up "${projectName}" in config but found no entry.`,
    };
  }

  logger.debug("T1: project config found", {
    projectName,
    repoUrl: projectConfig.repoUrl,
    mainBranch: projectConfig.mainBranch,
  });

  return {
    ok: true,
    repoRoot,
    projectName,
    mainBranch: projectConfig.mainBranch,
    repoUrl: projectConfig.repoUrl,
  };
}
