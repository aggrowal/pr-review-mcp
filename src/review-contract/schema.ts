import { z } from "zod";

export const HeadingStatusSchema = z.enum([
  "blocker",
  "needs_improvement",
  "nudge",
  "looks_good",
]);

export const VerdictSchema = z.enum([
  "APPROVE",
  "REQUEST_CHANGES",
  "NEEDS_DISCUSSION",
]);

const PositiveIntArraySchema = z.array(z.number().int().positive());

export const HeadingCoverageSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    status: HeadingStatusSchema,
    passedSubpoints: PositiveIntArraySchema,
    failedSubpoints: PositiveIntArraySchema,
    why: z.string().min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const passedSet = new Set<number>();
    for (const id of value.passedSubpoints) {
      if (passedSet.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["passedSubpoints"],
          message: "passedSubpoints cannot contain duplicates",
        });
      }
      passedSet.add(id);
    }

    const failedSet = new Set<number>();
    for (const id of value.failedSubpoints) {
      if (failedSet.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["failedSubpoints"],
          message: "failedSubpoints cannot contain duplicates",
        });
      }
      if (passedSet.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["failedSubpoints"],
          message: "subpoint id cannot be both passed and failed",
        });
      }
      failedSet.add(id);
    }
  });

export const TrackCoverageSchema = z
  .object({
    trackId: z.string().min(1),
    overallStatus: HeadingStatusSchema,
    headings: z.array(HeadingCoverageSchema).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seenHeadingIds = new Set<string>();
    for (const heading of value.headings) {
      if (seenHeadingIds.has(heading.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["headings"],
          message: `duplicate heading id "${heading.id}" in track "${value.trackId}"`,
        });
      }
      seenHeadingIds.add(heading.id);
    }
  });

export const ContractComplianceSchema = z
  .object({
    status: z.enum(["PASS", "FAIL"]),
    gaps: z.array(z.string().min(1)).optional(),
    reason: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "FAIL") {
      if (!value.gaps || value.gaps.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["gaps"],
          message: "gaps are required when contract compliance is FAIL",
        });
      }
      if (!value.reason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reason"],
          message: "reason is required when contract compliance is FAIL",
        });
      }
      return;
    }

    if (value.gaps && value.gaps.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gaps"],
        message: "gaps must be omitted or empty when contract compliance is PASS",
      });
    }
    if (value.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "reason must be omitted when contract compliance is PASS",
      });
    }
  });

export const ReviewIssueSchema = z
  .object({
    status: HeadingStatusSchema,
    trackId: z.string().min(1),
    file: z.string().min(1).optional(),
    lines: z.string().min(1).optional(),
    summary: z.string().min(1),
    why: z.string().min(1),
    betterImplementation: z.string().min(1).optional(),
  })
  .strict();

export const ReviewReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    project: z.string().min(1),
    branch: z
      .object({
        head: z.string().min(1),
        base: z.string().min(1),
      })
      .strict(),
    stack: z
      .object({
        language: z.string().min(1),
        frameworks: z.array(z.string().min(1)),
      })
      .strict(),
    verdict: VerdictSchema,
    contractCompliance: ContractComplianceSchema,
    trackCoverage: z.array(TrackCoverageSchema),
    strengths: z.array(z.string().min(1)),
    issues: z.array(ReviewIssueSchema),
    summary: z.string().min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seenTrackIds = new Set<string>();
    for (const track of value.trackCoverage) {
      if (seenTrackIds.has(track.trackId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["trackCoverage"],
          message: `duplicate trackId "${track.trackId}"`,
        });
      }
      seenTrackIds.add(track.trackId);
    }
  });
