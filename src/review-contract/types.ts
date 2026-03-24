import type { z } from "zod";
import type {
  ContractComplianceSchema,
  HeadingCoverageSchema,
  HeadingStatusSchema,
  ReviewIssueSchema,
  ReviewReportSchema,
  TrackCoverageSchema,
  VerdictSchema,
} from "./schema.js";

export type HeadingStatus = z.infer<typeof HeadingStatusSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type HeadingCoverage = z.infer<typeof HeadingCoverageSchema>;
export type TrackCoverage = z.infer<typeof TrackCoverageSchema>;
export type ContractCompliance = z.infer<typeof ContractComplianceSchema>;
export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;
export type ReviewReport = z.infer<typeof ReviewReportSchema>;
