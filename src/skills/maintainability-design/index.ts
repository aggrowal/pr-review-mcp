import type { SkillMetadata, DiffContext, DetectedContext } from "../../types.js";

export const metadata: SkillMetadata = {
  id: "maintainability-design",
  name: "Maintainability & Design",
  description:
    "Module boundaries, complexity control, cohesion/coupling, and long-term code health.",
  requires: {
    language: ["*"],
    framework: ["*"],
  },
  produces: "maintainability",
};

export function buildPrompt(_diff: DiffContext, ctx: DetectedContext): string {
  return `You are reviewing code for **maintainability and design quality** in a ${ctx.language} project.
Use the shared changed-files payload from the parent prompt.

## What to check

### A. Responsibility and Cohesion

1. **Mixed responsibilities** -- a function/class/module now handles unrelated concerns.
2. **Leaky abstraction boundaries** -- domain rules spread into infrastructure/UI glue (or inverse).
3. **Feature scattering** -- one behavior requires edits across too many disconnected locations.
4. **High change amplification** -- simple future changes likely to require touching many files.

### B. Coupling and Dependency Direction

5. **Tight coupling introduced** -- modules depend on concrete internals instead of stable contracts.
6. **Layering inversion** -- lower-level code depends on higher-level policy modules.
7. **Circular dependency risk** -- new imports or references create dependency cycles.
8. **Global/stateful dependency creep** -- hidden shared state makes behavior harder to reason about.

### C. Complexity and Readability

9. **Cognitive complexity spikes** -- deep nesting, long branches, or intertwined conditionals.
10. **Control-flow opacity** -- execution path is difficult to predict from local reading.
11. **Magic constants and implicit conventions** -- important behavior encoded in unexplained literals.
12. **Naming drift against intent** -- symbols hide real behavior or domain semantics.

### D. Extensibility and Change Safety

13. **Brittle extension points** -- likely future cases require invasive edits.
14. **Poorly isolated policy decisions** -- core rules duplicated instead of centralized.
15. **Hard-to-test structure** -- design choices make reliable verification unnecessarily difficult.
16. **Refactor-hostile structure** -- no seams for extraction/replacement.

### E. Documentation and Discoverability

17. **Missing rationale for non-obvious decisions** -- future maintainers cannot infer why trade-offs were made.
18. **Public contract docs drift** -- exposed behavior changed without corresponding docs.
19. **Onboarding friction** -- code organization no longer matches project conventions.
20. **Dead comments or misleading docs** -- comments contradict current behavior.

## Rules

- Focus on maintainability risks that create real future change cost or defect risk.
- Do not block on minor stylistic preferences that do not impact design quality.
- Prefer concrete refactor suggestions with clear benefit and bounded scope.
- Positive findings are encouraged when the change simplifies boundaries and improves clarity.`;
}
