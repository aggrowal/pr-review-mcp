import type { SkillMetadata, DiffContext, DetectedContext } from "../../types.js";

export const metadata: SkillMetadata = {
  id: "correctness",
  name: "Correctness",
  description:
    "Contracts/invariants, data integrity, failure semantics, async ordering, " +
    "idempotency/time, boundaries/units, API shape, resource lifecycle.",
  requires: {
    language: ["*"],
    framework: ["*"],
  },
  produces: "correctness",
};

export function buildPrompt(_diff: DiffContext, ctx: DetectedContext): string {
  return `You are reviewing code for **correctness** in a ${ctx.language} project.
Use the shared changed-files payload from the parent prompt. Focus on added/modified behavior.

## What to check

### A. Contract and Invariant Correctness

1. **Broken preconditions and postconditions** -- missing guard clauses, unchecked assumptions, or return values that violate contract guarantees.
2. **Invalid state transitions** -- updates that move an entity to an impossible or contradictory state.
3. **Partial success without recovery** -- one step succeeds, a later step fails, and the system is left inconsistent.

### B. Data Integrity and Mutation Safety

4. **Read-modify-write races** -- stale reads or lost updates when concurrent requests mutate the same record/key.
5. **Non-atomic multi-step mutation** -- related writes split across operations without transaction or compensation semantics.
6. **Missing uniqueness or version checks** -- duplicate records or overwrite of newer data due to absent conflict detection.

### C. Error and Failure Semantics

7. **Swallowed or downgraded failures** -- exceptions converted into success paths or ignored without safe fallback.
8. **Fail-open defaults** -- fallback values that silently produce wrong business outcomes when dependencies fail.
9. **Retry behavior mismatch** -- retry loops for non-retryable errors, missing backoff/bounds, or no retry for transient failures.

### D. Concurrency and Async Ordering

10. **Missing await or unhandled async failure** -- promises not awaited, unhandled rejections, or detached task failures.
11. **Ordering assumptions across async work** -- logic assumes completion order that is not guaranteed.
12. **Missing cancellation or timeout propagation** -- work continues after caller timeout/cancel, causing stale or duplicate side effects.

### E. Time and Idempotency Semantics

13. **Duplicate side effects under retries/replays** -- side-effecting operations without idempotency guard (for example, idempotency key or dedupe token).
14. **HTTP method semantic mismatch** -- state-changing behavior on methods expected to be safe/idempotent by protocol semantics (RFC 9110).
15. **Time window and clock logic bugs** -- TTL/expiry comparisons, timezone drift, or wall-clock assumptions that break correctness.

### F. Boundary, Numeric, and Unit Correctness

16. **Boundary condition failures** -- empty/singleton inputs, off-by-one indexing, or missing first/last element handling.
17. **Numeric safety errors** -- overflow/underflow, division by zero, or sign/rounding mistakes.
18. **Unit and precision mismatch** -- ms vs s, bytes vs KB, decimal money precision, or implicit conversion bugs.

### G. API and Data-Shape Correctness

19. **Schema mismatch across boundaries** -- required/optional field drift or incompatible payload assumptions.
20. **Unsafe decoding/parsing assumptions** -- code assumes shape/type that external input does not guarantee.
21. **Validation gaps before persistence/use** -- malformed values accepted and later used as if validated.

### H. Resource Lifecycle and Cleanup Correctness

22. **Incomplete cleanup across exit paths** -- handles/connections/locks not released on error or early return.
23. **Cleanup ordering defects** -- commit-before-validate, use-after-close, or finalize-before-publish errors.
24. **Stale cache or invalidation mismatch** -- writes not reflected in cache/index/read model, causing incorrect responses.

## Rules

- Only flag issues where the code is **demonstrably wrong** or has a **concrete failure scenario**.
- Do not flag style, naming, formatting, or refactor preferences.
- For each finding, include a specific file and line range from the shared changed-files payload.
- Cite standards (for example RFC 9110 method semantics) only when they materially strengthen the explanation.
- Positive findings are encouraged when the change clearly improves correctness resilience.`;
}
