import { execSync } from "child_process";
import type { Logger } from "../logger.js";
import type { BranchContext, PrEnrichment } from "../types.js";

export interface DiffEnrichmentOptions {
  enabled?: boolean;
  provider?: "git";
  maxCommits?: number;
}

export interface DiffEnrichmentProvider {
  id: string;
  enrich(
    context: BranchContext,
    logger: Logger,
    options: Required<DiffEnrichmentOptions>
  ): PrEnrichment | undefined;
}

class GitEnrichmentProvider implements DiffEnrichmentProvider {
  readonly id = "git";

  enrich(
    context: BranchContext,
    logger: Logger,
    options: Required<DiffEnrichmentOptions>
  ): PrEnrichment | undefined {
    const commitRange = `${context.baseBranch}..${context.headBranch}`;
    const logCmd = `git log --format=%s%n%b%x1e "${commitRange}" --max-count=${options.maxCommits}`;
    logger.debug("Enrichment: collecting git metadata", {
      provider: this.id,
      commitRange,
      maxCommits: options.maxCommits,
    });

    try {
      const raw = execSync(logCmd, {
        cwd: context.repoRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();

      if (!raw) return undefined;

      const entries = raw
        .split("\u001e")
        .map((entry) => entry.trim())
        .filter(Boolean);

      if (entries.length === 0) return undefined;

      const [firstEntry] = entries;
      const firstLines = firstEntry.split("\n");
      const title = firstLines[0]?.trim();
      const description = firstLines
        .slice(1)
        .map((line) => line.trimEnd())
        .join("\n")
        .trim();

      return {
        prTitle: title || undefined,
        prDescription: description || undefined,
        prUrl: buildCompareUrl(
          context.repoUrl,
          context.baseBranch,
          context.headBranch
        ),
      };
    } catch (error) {
      logger.warn("Enrichment: git metadata collection failed", {
        provider: this.id,
        detail: String(error),
      });
      return undefined;
    }
  }
}

const PROVIDERS: Record<string, DiffEnrichmentProvider> = {
  git: new GitEnrichmentProvider(),
};

export function enrichDiffContext(
  context: BranchContext,
  logger: Logger,
  options?: DiffEnrichmentOptions
): PrEnrichment | undefined {
  const normalized: Required<DiffEnrichmentOptions> = {
    enabled: options?.enabled ?? false,
    provider: options?.provider ?? "git",
    maxCommits: options?.maxCommits ?? 5,
  };
  if (!normalized.enabled) return undefined;

  const provider = PROVIDERS[normalized.provider];
  if (!provider) {
    logger.warn("Enrichment: unknown provider requested", {
      provider: normalized.provider,
    });
    return undefined;
  }

  return provider.enrich(context, logger, normalized);
}

function buildCompareUrl(
  repoUrl: string,
  baseBranch: string,
  headBranch: string
): string | undefined {
  const normalized = normalizeRepoUrl(repoUrl);
  if (!normalized) return undefined;
  return `${normalized}/compare/${encodeURIComponent(
    baseBranch
  )}...${encodeURIComponent(headBranch)}`;
}

function normalizeRepoUrl(repoUrl: string): string | undefined {
  if (!repoUrl) return undefined;
  if (repoUrl.startsWith("http://") || repoUrl.startsWith("https://")) {
    return repoUrl.replace(/\.git$/, "");
  }

  const sshMatch = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(repoUrl.trim());
  if (!sshMatch) return undefined;
  return `https://${sshMatch[1]}/${sshMatch[2]}`;
}
