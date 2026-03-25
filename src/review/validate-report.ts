import type { TrackExecutionContract } from "../prompt/assemble.js";
import { ReviewReportSchema } from "../review-contract/schema.js";
import type { ReviewReport } from "../review-contract/types.js";

export interface ReportValidationSuccess {
  ok: true;
  report: ReviewReport;
}

export interface ReportValidationFailure {
  ok: false;
  issues: string[];
}

export type ReportValidationResult =
  | ReportValidationSuccess
  | ReportValidationFailure;

export function validateReviewDraft(
  rawDraft: string | unknown,
  trackContracts: TrackExecutionContract[]
): ReportValidationResult {
  const parsedJson = parseJsonDraft(rawDraft);
  if (!parsedJson.ok) {
    return {
      ok: false,
      issues: [parsedJson.reason],
    };
  }

  const schemaParsed = ReviewReportSchema.safeParse(parsedJson.value);
  if (!schemaParsed.success) {
    return {
      ok: false,
      issues: schemaParsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`
      ),
    };
  }

  const report = schemaParsed.data;
  const contractIssues = validateTrackCoverageContract(report, trackContracts);
  const verdictIssue = validateVerdict(report);
  const allIssues = [...contractIssues, ...(verdictIssue ? [verdictIssue] : [])];

  if (allIssues.length > 0) {
    return {
      ok: false,
      issues: allIssues,
    };
  }

  return {
    ok: true,
    report,
  };
}

export function buildRepairPrompt(issues: string[]): string {
  if (issues.length === 0) return "";
  const bullets = issues.slice(0, 30).map((issue) => `- ${issue}`).join("\n");
  return [
    "## Output correction required",
    "The previous response did not satisfy schema/contract requirements:",
    bullets,
    "Regenerate the full response as one valid JSON object and fix every listed issue.",
  ].join("\n");
}

function parseJsonDraft(rawDraft: string | unknown):
  | { ok: true; value: unknown }
  | { ok: false; reason: string } {
  if (typeof rawDraft !== "string") {
    if (rawDraft && typeof rawDraft === "object") {
      return { ok: true, value: rawDraft };
    }
    return {
      ok: false,
      reason: "Draft report must be a JSON object or a JSON string.",
    };
  }

  const trimmed = rawDraft.trim();
  if (!trimmed) {
    return { ok: false, reason: "Model response is empty." };
  }

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return { ok: false, reason: "Model response does not contain a JSON object." };
  }

  const jsonSlice = candidate.slice(start, end + 1);
  try {
    return { ok: true, value: JSON.parse(jsonSlice) };
  } catch (error) {
    return {
      ok: false,
      reason: `Model response is not valid JSON: ${String(error)}`,
    };
  }
}

function validateTrackCoverageContract(
  report: ReviewReport,
  trackContracts: TrackExecutionContract[]
): string[] {
  const issues: string[] = [];
  const expectedTrackIds = trackContracts.map((track) => track.trackId);
  const actualTrackIds = report.trackCoverage.map((track) => track.trackId);

  for (let index = 0; index < expectedTrackIds.length; index += 1) {
    if (actualTrackIds[index] !== expectedTrackIds[index]) {
      issues.push(
        `trackCoverage order mismatch at index ${index}. Expected "${expectedTrackIds[index]}", got "${actualTrackIds[index] ?? "missing"}".`
      );
    }
  }

  for (const actualTrackId of actualTrackIds) {
    if (!expectedTrackIds.includes(actualTrackId)) {
      issues.push(`Unexpected track in output: "${actualTrackId}".`);
    }
  }

  for (const contractTrack of trackContracts) {
    const actualTrack = report.trackCoverage.find(
      (track) => track.trackId === contractTrack.trackId
    );
    if (!actualTrack) {
      issues.push(`Missing required track "${contractTrack.trackId}".`);
      continue;
    }

    for (const contractHeading of contractTrack.headings) {
      const actualHeading = actualTrack.headings.find(
        (heading) => heading.id === contractHeading.id
      );
      if (!actualHeading) {
        issues.push(
          `Missing heading "${contractTrack.trackId}.${contractHeading.id}".`
        );
        continue;
      }

      const expectedSubpoints = new Set(contractHeading.subpoints);
      const actualSubpoints = [
        ...actualHeading.passedSubpoints,
        ...actualHeading.failedSubpoints,
      ];
      const uniqueActualSubpoints = new Set(actualSubpoints);

      if (actualSubpoints.length !== uniqueActualSubpoints.size) {
        issues.push(
          `Heading "${contractTrack.trackId}.${contractHeading.id}" contains duplicate subpoint assignments.`
        );
      }

      for (const expected of expectedSubpoints) {
        if (!uniqueActualSubpoints.has(expected)) {
          issues.push(
            `Missing subpoint "${contractTrack.trackId}.${contractHeading.id}.${expected}".`
          );
        }
      }

      for (const actual of uniqueActualSubpoints) {
        if (!expectedSubpoints.has(actual)) {
          issues.push(
            `Unexpected subpoint "${contractTrack.trackId}.${contractHeading.id}.${actual}".`
          );
        }
      }

      if (
        actualHeading.failedSubpoints.length === 0 &&
        actualHeading.why.trim().toLowerCase() !== "all pointers are positive"
      ) {
        issues.push(
          `Heading "${contractTrack.trackId}.${contractHeading.id}" must use "all pointers are positive" when no failed subpoints exist.`
        );
      }
    }

    for (const actualHeading of actualTrack.headings) {
      if (
        !contractTrack.headings.some((heading) => heading.id === actualHeading.id)
      ) {
        issues.push(
          `Unexpected heading "${contractTrack.trackId}.${actualHeading.id}" in output.`
        );
      }
    }
  }

  const normalizedGaps = normalizeContractGaps(issues);
  if (normalizedGaps.length === 0) {
    if (report.contractCompliance.status !== "PASS") {
      issues.push("contractCompliance.status must be PASS when no gaps exist.");
    }
    return issues;
  }

  if (report.contractCompliance.status !== "FAIL") {
    issues.push("contractCompliance.status must be FAIL when gaps exist.");
  }

  if (!report.contractCompliance.gaps || report.contractCompliance.gaps.length === 0) {
    issues.push("contractCompliance.gaps must list missing coverage details.");
  }

  if (!report.contractCompliance.reason) {
    issues.push("contractCompliance.reason must explain why coverage is incomplete.");
  }

  return issues;
}

function normalizeContractGaps(issues: string[]): string[] {
  const gapSignals = ["Missing", "Unexpected", "mismatch", "duplicate"];
  return issues.filter((issue) =>
    gapSignals.some((signal) => issue.includes(signal))
  );
}

function validateVerdict(report: ReviewReport): string | undefined {
  const statuses = report.issues.map((issue) => issue.status);
  if (statuses.includes("blocker") && report.verdict !== "REQUEST_CHANGES") {
    return "verdict must be REQUEST_CHANGES when blocker issues are present.";
  }

  if (
    !statuses.includes("blocker") &&
    statuses.includes("needs_improvement") &&
    report.verdict !== "NEEDS_DISCUSSION"
  ) {
    return "verdict must be NEEDS_DISCUSSION when needs_improvement issues are present and no blocker exists.";
  }

  if (
    !statuses.includes("blocker") &&
    !statuses.includes("needs_improvement") &&
    report.verdict !== "APPROVE"
  ) {
    return "verdict must be APPROVE when issues are only nudge/looks_good or empty.";
  }

  return undefined;
}
