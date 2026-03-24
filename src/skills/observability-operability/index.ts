import type { SkillMetadata, DiffContext, DetectedContext } from "../../types.js";

export const metadata: SkillMetadata = {
  id: "observability-operability",
  name: "Observability & Operability",
  description:
    "Golden signals, structured telemetry, actionable alerts, and production operability readiness.",
  requires: {
    language: ["*"],
    framework: ["*"],
  },
  produces: "observability",
};

export function buildPrompt(_diff: DiffContext, ctx: DetectedContext): string {
  return `You are reviewing code for **observability and operability** in a ${ctx.language} project.
Use the shared changed-files payload from the parent prompt.

## What to check

### A. Golden Signals Coverage

1. **Latency visibility gaps** -- changed paths lack timing/latency measurement where failures would be hard to diagnose.
2. **Traffic visibility gaps** -- request/work volume changes introduced without monitoring surface.
3. **Error signal quality issues** -- failures are swallowed or not reflected in observable error rates.
4. **Saturation blind spots** -- resource pressure risk introduced without capacity/saturation indicators.

### B. Logs and Diagnostics

5. **Unstructured or inconsistent logs** -- key events emitted in formats difficult to query/correlate.
6. **Missing correlation identifiers** -- logs cannot be tied to request/trace/entity context.
7. **Sensitive data in diagnostics** -- logs expose secrets/PII/token material.
8. **Low-actionability logging** -- errors logged without enough context to triage.

### C. Traces and Metrics Hygiene

9. **Trace propagation gaps** -- request context lost across async/remote boundaries.
10. **Metric cardinality hazards** -- labels/tags can explode in high-cardinality dimensions.
11. **Missing business-critical counters/histograms** -- changed behavior lacks meaningful outcome metrics.
12. **Inconsistent success/failure instrumentation** -- only success paths instrumented.

### D. Alerting and On-Call Actionability

13. **Alert-noise risk** -- likely to generate non-actionable pages/tickets.
14. **No failure-mode alerts for changed critical paths** -- important regressions could remain silent.
15. **No runbook/context hooks** -- operators cannot quickly map alert to owner or remediation path.
16. **Missing distinction between symptom and cause signals** -- alerting tied to noisy internals instead of user impact.

### E. Release and Runtime Operability

17. **No safe rollout controls** -- high-risk change cannot be canaried or disabled quickly.
18. **Weak health/readiness behavior** -- service status may appear healthy while core path is failing.
19. **Poor degraded-mode observability** -- fallback behavior cannot be tracked and audited.
20. **Insufficient operational metadata** -- changed jobs/tasks lack identifiers needed for production debugging.

## Rules

- Prioritize findings that affect incident detection and mean time to recovery.
- Tie each finding to concrete operational impact (missed detection, slow triage, noisy paging).
- Avoid requiring exhaustive instrumentation where risk is low.
- Positive findings are encouraged when telemetry is structured, correlated, and actionable.`;
}
