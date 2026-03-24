import type { SkillMetadata, DiffContext, DetectedContext } from "../../types.js";

export const metadata: SkillMetadata = {
  id: "api-contract-compatibility",
  name: "API Contract & Compatibility",
  description:
    "Backward compatibility, HTTP semantics, schema stability, and error contract consistency.",
  requires: {
    language: ["*"],
    framework: ["*"],
  },
  produces: "api-contract",
};

export function buildPrompt(_diff: DiffContext, ctx: DetectedContext): string {
  return `You are reviewing code for **API contract and compatibility** in a ${ctx.language} project.
Use the shared changed-files payload from the parent prompt.

## What to check

### A. Backward Compatibility

1. **Breaking field changes** -- removed/renamed fields or narrowed types in responses/contracts.
2. **Behavioral semantic drift** -- same schema but different behavior that can break existing clients.
3. **Changed defaults** -- default values or implied behavior changed without migration strategy.
4. **Stricter validation without compatibility plan** -- previously accepted client requests now rejected.

### B. Versioning and Deprecation Safety

5. **No version boundary for breaking changes** -- incompatible behavior introduced in-place.
6. **Undeclared deprecations/removals** -- legacy paths removed without deprecation signaling.
7. **Inconsistent dual-path behavior** -- old and new versions produce conflicting semantics.
8. **Migration ambiguity** -- client upgrade path not inferable from behavior/documented contract.

### C. HTTP and Protocol Semantics

9. **Safe/idempotent mismatch** -- state-changing behavior under methods expected to be safe/idempotent (RFC 9110).
10. **Status code misuse** -- success/failure codes do not match operation outcomes.
11. **Cache/control semantic conflicts** -- response behavior conflicts with cacheability expectations.
12. **Method-level invariants broken** -- retries or automated callers can cause unintended side effects.

### D. Error Contract Quality

13. **Inconsistent error envelope** -- shape of error response varies unpredictably.
14. **Missing machine-readable identifiers** -- no stable type/code for programmatic handling.
15. **Overexposed internals in errors** -- implementation details leaked to clients.
16. **Problem details misuse** -- RFC 9457 fields ('type', 'title', 'status', 'detail', 'instance') missing or inconsistent where format is used.

### E. Cross-Boundary Schema Integrity

17. **Request/response shape mismatch** -- handler assumptions diverge from declared schema.
18. **Enum/value evolution hazards** -- newly introduced values likely to break strict client parsing.
19. **Pagination/filter/sort contract drift** -- output ordering and result boundaries changed unexpectedly.
20. **Event/message contract breakage** -- producer and consumer expectations diverge in changed payloads.

## Rules

- Treat compatibility as a client contract, not only a compile-time concern.
- Prioritize realistic breakages for existing consumers and integrations.
- Include the specific field/endpoint/message shape that changed and why this breaks compatibility.
- Positive findings are encouraged when changes are additive, versioned, and migration-safe.`;
}
