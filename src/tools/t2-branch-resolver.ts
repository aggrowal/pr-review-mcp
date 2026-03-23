import { execSync } from "child_process";
import type { BranchContext } from "../types.js";
import type { ProjectGuardOk } from "./t1-project-guard.js";
import type { Logger } from "../logger.js";

export interface BranchResolverOk {
  ok: true;
  context: BranchContext;
}

export interface BranchResolverError {
  ok: false;
  reason: string;
  hint: string;
  detail?: string;
}

export type BranchResolverResult = BranchResolverOk | BranchResolverError;

/**
 * T2 -- Branch Resolver
 *
 * Validates an explicit branch name. Never defaults to the current checkout --
 * the caller must always specify which branch to review.
 * On failure, attempts fuzzy matching to suggest similar branch names.
 */
export function runBranchResolver(
  guard: ProjectGuardOk,
  explicitBranchName: string | undefined,
  logger: Logger
): BranchResolverResult {
  const { repoRoot, mainBranch, projectName, repoUrl } = guard;

  if (!explicitBranchName || explicitBranchName.trim() === "") {
    logger.error("T2: no branch name provided");
    return {
      ok: false,
      reason: "No branch name provided.",
      hint:
        "Specify the branch explicitly: @pr_review branch: feature/my-branch\n" +
        "To see available branches run: git branch --list",
    };
  }

  const headBranch = explicitBranchName.trim();
  const verifyCmd = `git rev-parse --verify "${headBranch}"`;
  logger.debug(`T2: verifying branch "${headBranch}"`, { cmd: verifyCmd, cwd: repoRoot });

  try {
    execSync(verifyCmd, {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    const stderr = e instanceof Error ? (e as any).stderr?.toString?.() ?? String(e) : String(e);
    logger.error(`T2: branch "${headBranch}" not found`, { stderr });

    let similar = "";
    try {
      const allBranches = execSync("git branch --list", {
        cwd: repoRoot,
        encoding: "utf-8",
      })
        .split("\n")
        .map((b) => b.replace(/^\*?\s+/, ""))
        .filter(Boolean);

      logger.debug("T2: fuzzy matching against local branches", { count: allBranches.length });

      const close = allBranches.filter(
        (b) =>
          b.includes(headBranch) ||
          headBranch.includes(b) ||
          levenshtein(b, headBranch) <= 3
      );
      if (close.length > 0) {
        similar = ` Did you mean: ${close.slice(0, 3).join(", ")}?`;
        logger.warn(`T2: similar branches found: ${close.slice(0, 3).join(", ")}`);
      }
    } catch {
      logger.debug("T2: failed to list branches for fuzzy matching");
    }

    return {
      ok: false,
      reason: `Branch "${headBranch}" not found in local repo.`,
      hint:
        `Fetch the branch first with: git fetch origin ${headBranch}` +
        (similar ? "\n" + similar : ""),
      detail: `Command "${verifyCmd}" failed: ${stderr}`,
    };
  }

  if (headBranch === mainBranch) {
    logger.error(`T2: head branch equals base branch "${mainBranch}"`);
    return {
      ok: false,
      reason: `Head branch and base branch are both "${mainBranch}" -- nothing to compare.`,
      hint: "Pass a different branch name -- the one containing the changes you want reviewed.",
    };
  }

  logger.debug("T2: branch verified", { headBranch, baseBranch: mainBranch });

  return {
    ok: true,
    context: {
      projectName,
      repoRoot,
      baseBranch: mainBranch,
      headBranch,
      repoUrl,
    },
  };
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
