import type { SkillMetadata, DiffContext, DetectedContext } from "../../types.js";

export const metadata: SkillMetadata = {
  id: "testing-quality",
  name: "Testing Quality",
  description:
    "Coverage adequacy, edge-case validation, flaky-test risk, and assertion quality.",
  requires: {
    language: ["*"],
    framework: ["*"],
  },
  produces: "testing",
};

export function buildPrompt(_diff: DiffContext, ctx: DetectedContext): string {
  return `You are reviewing code for **testing quality and verification gaps** in a ${ctx.language} project.
Use the shared changed-files payload from the parent prompt.

## What to check

### A. Coverage of Changed Behavior

1. **Missing tests for new logic** -- changed behavior has no direct verification.
2. **No regression test for bug fixes** -- fix lacks a test that would fail pre-fix.
3. **Only happy-path validation** -- error and edge cases are untested.
4. **Critical path untested** -- high-risk flow changed without commensurate test depth.

### B. Boundary and Negative Testing

5. **Boundary conditions omitted** -- empty, null, singleton, max-size, and off-by-one scenarios missing.
6. **Validation and failure-path gaps** -- malformed input and dependency-failure behavior untested.
7. **Concurrency/race-sensitive behavior untested** -- async ordering or retry/idempotency paths not exercised.
8. **State-transition coverage gaps** -- lifecycle transitions tested incompletely.

### C. Test Design Quality

9. **Weak assertions** -- tests check superficial signals but not business-critical outcomes.
10. **Over-mocked behavior** -- tests pass while real integrations would break.
11. **Coupled to implementation details** -- brittle tests tied to private internals.
12. **Ambiguous intent** -- test names/setup do not clearly describe expected behavior.

### D. Flakiness and Determinism

13. **Time-dependent flakiness risk** -- reliance on wall-clock timing/sleeps.
14. **Order-dependent tests** -- hidden shared state across tests.
15. **External dependency instability** -- network/filesystem dependence without stabilization.
16. **Nondeterministic assertions** -- random/parallel outcomes not controlled.

### E. Maintainable Verification Strategy

17. **Missing test pyramid balance** -- no focused unit tests where they would be most effective.
18. **Insufficient integration confidence** -- boundary contracts changed without integration checks.
19. **No observability assertions where needed** -- critical logs/metrics/events behavior changed but unverified.
20. **Unsupported refactor confidence** -- substantial structural changes with minimal safety net.

## Rules

- Report only concrete test gaps implied by changed behavior in the payload.
- Distinguish truly missing coverage from acceptable scope trade-offs.
- Prefer specific, minimal additions (unit/integration/system) over broad generic requests.
- Positive findings are encouraged when tests are precise, deterministic, and regression-focused.`;
}
