import type { SkillMetadata, DiffContext, DetectedContext } from "../../types.js";

export const metadata: SkillMetadata = {
  id: "redundancy",
  name: "Redundancy",
  description:
    "Duplicate logic, dead paths, unused artifacts, speculative abstraction, and avoidable waste.",
  requires: {
    language: ["*"],
    framework: ["*"],
  },
  produces: "redundancy",
};
export function buildPrompt(_diff: DiffContext, ctx: DetectedContext): string {
  return `You are reviewing code for **redundancy and waste** in a ${ctx.language} project.
Use the shared changed-files payload from the parent prompt to detect duplication and unnecessary complexity.

## What to check

### A. Duplicate Logic and Near-Duplicates

1. **Direct copy-paste duplication** -- identical or almost-identical logic reintroduced in new code.
2. **Structural near-duplicates** -- same control flow and behavior with only renamed variables/literals.
3. **Cross-file duplicate behavior** -- logic in one changed file re-implements behavior that already exists in another changed file.
4. **Duplicate validation/parsing branches** -- repeated input checks or transformation pipelines that should be centralized.

### B. Dead and Unreachable Code

5. **Unused declarations** -- functions, classes, constants, or locals that are never read/called.
6. **Unreachable branches** -- conditions that cannot be true given visible logic.
7. **Write-only state** -- assignments whose values are never consumed.
8. **Legacy fallback leftovers** -- old code paths retained after migration without active usage.

### C. Import/Dependency Redundancy

9. **Unused imports/exports** -- imported/exported symbols with no observable usage.
10. **Parallel utility dependencies** -- multiple libs solving the same problem in nearby code paths without reason.
11. **Redundant wrappers** -- wrappers around wrappers that add no policy, validation, or adaptation value.

### D. Redundant Computation and Data Movement

12. **Repeat computation** -- same expensive or non-trivial transform repeated instead of reused.
13. **Unnecessary conversion chains** -- data converted back and forth with no semantic benefit.
14. **Redundant condition fragments** -- identical statements repeated in each conditional branch.
15. **Over-copying data** -- needless cloning/spreading/serialization where immutable guarantees already hold.

### E. Premature Abstraction and Over-Engineering

16. **Single-use abstractions** -- generic interfaces/factories/strategy layers with only one implementation and no near-term second caller.
17. **Speculative extension points** -- hooks and options added for hypothetical future cases.
18. **Indirection without signal** -- additional files/classes/functions that do not improve clarity, reuse, or policy control.

### F. Reinvented Utilities

19. **Stdlib reimplementation** -- custom code replacing established language/library primitives.
20. **Reimplemented framework behavior** -- manual plumbing where framework already provides robust primitives.
21. **Custom helper drift** -- local helpers diverging from existing project utility contracts for the same task.

### G. Debug and Review Noise

22. **Leftover debug instrumentation** -- console logs, temporary dumps, print statements, ad hoc flags, or debugger hooks.
23. **Temporary comments/markers shipped** -- TODO/FIXME/HACK notes left in production code without issue tracking context.
24. **Noise-only scaffolding** -- placeholder files/branches inserted without active behavior.

## Rules

- For duplication, cite both locations: the new location and the existing location it overlaps.
- Do not flag intentional repetition where abstraction would hurt readability (for example, explicit test cases).
- Distinguish true waste from deliberate trade-offs (clarity, safety, or compatibility).
- Prefer concrete cleanup suggestions that reduce code while preserving behavior.
- Positive findings are encouraged when code removes duplication, dead paths, or unnecessary abstraction.`;
}
