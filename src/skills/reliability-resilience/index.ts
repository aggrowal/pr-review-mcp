import type { SkillMetadata, DiffContext, DetectedContext } from "../../types.js";

export const metadata: SkillMetadata = {
  id: "reliability-resilience",
  name: "Reliability & Resilience",
  description:
    "Timeouts, retries, idempotency, graceful degradation, and failure containment.",
  requires: {
    language: ["*"],
    framework: ["*"],
  },
  produces: "reliability",
};

export function buildPrompt(_diff: DiffContext, ctx: DetectedContext): string {
  return `You are reviewing code for **reliability and resilience** in a ${ctx.language} project.
Use the shared changed-files payload from the parent prompt.

## What to check

### A. Timeouts, Cancellation, and Bounded Work

1. **Missing timeout boundaries** -- outbound calls or long-running tasks without explicit timeout budgets.
2. **Lost cancellation signals** -- cancellation/deadline not propagated to downstream operations.
3. **Unbounded retries or loops** -- no maximum attempts, no cap on recovery work.
4. **Cleanup gaps on timeout/cancel** -- in-flight resources left open after aborted work.

### B. Retry and Backoff Correctness

5. **Retrying non-retryable failures** -- permanent errors retried as if transient.
6. **No exponential backoff with jitter** -- retry storms risk thundering herds.
7. **Retry amplification across layers** -- stacked retries causing multiplicative request load.
8. **Inconsistent retry contracts** -- caller retries despite callee signaling do-not-retry conditions.

### C. Idempotency and Side-Effect Safety

9. **Duplicate side effects under retry/replay** -- writes/charges/emails/events not guarded.
10. **No idempotency keys or dedupe tokens** -- external operations can execute more than once.
11. **At-least-once consumers without dedupe** -- message handlers re-apply effects on redelivery.
12. **Ambiguous partial success handling** -- multi-step operations lack recovery/compensation.

### D. Degradation and Failure Containment

13. **No graceful fallback path** -- dependency outage cascades directly to full failure.
14. **Fail-open behavior on degraded dependencies** -- disabled checks can grant unsafe/default access.
15. **No load shedding or admission control** -- service accepts more than it can safely process.
16. **Circuit-breaker absence/misuse** -- repeated calls into known-failing dependencies.

### E. Operational Recovery and Safety

17. **Insufficient state protection during restart** -- in-flight state lost or corrupted on crash/restart.
18. **Missing startup/readiness checks** -- traffic accepted before dependencies are usable.
19. **No rollback-friendly toggles** -- risky behavior cannot be quickly disabled.
20. **Weak fault visibility hooks** -- failures lack structured signals needed for fast triage.

## Rules

- Focus on concrete failure modes and cascading-risk scenarios.
- Tie each finding to an observable trigger (dependency outage, latency spike, retries, restart).
- Do not report theoretical resilience patterns with no plausible impact in this change.
- Positive findings are encouraged when the code clearly improves failure containment and recovery.`;
}
