import type { ReviewReport, ReviewIssue } from "../review-contract/types.js";
import type { LlmUsage } from "../llm/provider.js";

const VERDICT_LABELS: Record<string, string> = {
  APPROVE: "APPROVE",
  REQUEST_CHANGES: "REQUEST CHANGES",
  NEEDS_DISCUSSION: "NEEDS DISCUSSION",
};

const STATUS_LABELS: Record<string, string> = {
  blocker: "Blocker",
  needs_improvement: "Needs Improvement",
  nudge: "Nudge",
  looks_good: "Looks Good",
};

export function formatReviewAsMarkdown(params: {
  review: ReviewReport;
  provider?: string;
  model?: string;
  attempts: number;
  latencyMs?: number;
  usage?: LlmUsage;
}): string {
  const { review } = params;
  const parts: string[] = [];

  parts.push(`# PR Review: ${review.project}`);
  parts.push("");
  parts.push(`**${review.branch.head}** -> **${review.branch.base}**`);
  parts.push("");

  parts.push(`## Verdict: ${VERDICT_LABELS[review.verdict] ?? review.verdict}`);
  parts.push("");
  parts.push(review.summary);
  parts.push("");

  if (review.strengths.length > 0) {
    parts.push("## Strengths");
    parts.push("");
    for (const s of review.strengths) {
      parts.push(`- ${s}`);
    }
    parts.push("");
  }

  const blockers = review.issues.filter((i) => i.status === "blocker");
  const improvements = review.issues.filter((i) => i.status === "needs_improvement");
  const nudges = review.issues.filter((i) => i.status === "nudge");

  if (blockers.length > 0) {
    parts.push("## Blockers");
    parts.push("");
    parts.push(...formatIssueList(blockers));
    parts.push("");
  }

  if (improvements.length > 0) {
    parts.push("## Needs Improvement");
    parts.push("");
    parts.push(...formatIssueList(improvements));
    parts.push("");
  }

  if (nudges.length > 0) {
    parts.push("## Nudges");
    parts.push("");
    parts.push(...formatIssueList(nudges));
    parts.push("");
  }

  parts.push("## Track Coverage");
  parts.push("");
  for (const track of review.trackCoverage) {
    const statusLabel = STATUS_LABELS[track.overallStatus] ?? track.overallStatus;
    parts.push(`### ${track.trackId} -- ${statusLabel}`);
    parts.push("");
    for (const heading of track.headings) {
      const hStatus = STATUS_LABELS[heading.status] ?? heading.status;
      const failed = heading.failedSubpoints.length;
      const total = heading.passedSubpoints.length + failed;
      parts.push(`- **${heading.id}. ${heading.title}**: ${hStatus} (${total - failed}/${total} passed)`);
    }
    parts.push("");
  }

  parts.push("---");
  parts.push("");
  const footerParts = [
    `Stack: ${review.stack.language}` +
      (review.stack.frameworks.length > 0
        ? ` (${review.stack.frameworks.join(", ")})`
        : ""),
  ];

  if (params.provider || params.model) {
    footerParts.push(
      `Model: ${params.provider ?? "host_model"}/${params.model ?? "unspecified"}`
    );
  }

  if (typeof params.latencyMs === "number") {
    footerParts.push(`${params.latencyMs}ms`);
  }

  if (params.attempts > 1) {
    footerParts.push(`${params.attempts} attempts`);
  }

  parts.push(`*${footerParts.join(" | ")}*`);

  return parts.join("\n");
}

function formatIssueList(issues: ReviewIssue[]): string[] {
  const lines: string[] = [];
  for (const issue of issues) {
    const loc = [issue.file, issue.lines].filter(Boolean).join(":");
    const header = loc ? `**${issue.summary}** (${loc})` : `**${issue.summary}**`;
    lines.push(`- ${header}`);
    lines.push(`  ${issue.why}`);
    if (issue.betterImplementation) {
      lines.push(`  *Suggestion:* ${issue.betterImplementation}`);
    }
  }
  return lines;
}
