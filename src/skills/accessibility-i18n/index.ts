import type { SkillMetadata, DiffContext, DetectedContext } from "../../types.js";

export const metadata: SkillMetadata = {
  id: "accessibility-i18n",
  name: "Accessibility & i18n",
  description:
    "Keyboard/focus semantics, assistive labels, visual accessibility, and localization readiness.",
  requires: {
    language: ["*"],
    framework: ["*"],
    patterns: ["frontend-ui"],
  },
  produces: "accessibility",
};

export function buildPrompt(_diff: DiffContext, _ctx: DetectedContext): string {
  return `You are reviewing code for **accessibility and internationalization** in frontend-facing changes.
Use the shared changed-files payload from the parent prompt.

## What to check

### A. Semantic and Assistive Technology Support

1. **Missing semantic roles/structure** -- interactive UI rendered without appropriate semantic elements.
2. **Missing labels/accessible names** -- controls not discoverable for screen-reader users.
3. **Non-descriptive alt/text equivalents** -- meaningful visuals lack equivalent text.
4. **Dynamic content announcement gaps** -- important updates not conveyed to assistive tech.

### B. Keyboard and Focus Behavior

5. **Keyboard inoperability** -- interactions require pointer input and cannot be reached with keyboard only.
6. **Focus trap or loss** -- focus disappears or moves unpredictably after state transitions.
7. **Invisible focus indicators** -- focused elements provide no clear visual affordance.
8. **Incorrect tab order** -- navigation order differs from meaningful reading/interaction order.

### C. Perception and Interaction Quality

9. **Insufficient contrast risk** -- text or controls likely unreadable in common contexts.
10. **Touch target/interaction affordance issues** -- controls too small or ambiguous.
11. **Color-only signaling** -- status communicated only via color without alternate cue.
12. **Motion/animation without safeguards** -- disruptive behavior lacks reduction options.

### D. Localization and Global Readiness

13. **Hardcoded user-facing strings** -- new text bypasses localization pipeline.
14. **Locale-insensitive formatting** -- date/time/number/currency formatting assumes one locale.
15. **RTL/layout fragility** -- directional assumptions break mirrored layouts.
16. **Concatenated phrase construction** -- string assembly that blocks correct translation grammar.

### E. Contract and Regression Safety

17. **A11y regressions in existing flows** -- refactor alters semantics/focus without preserving behavior.
18. **No coverage for critical a11y interactions** -- changed components lack basic keyboard/focus checks.
19. **Missing fallback content** -- media/interactive components fail without non-visual alternatives.
20. **Inconsistent i18n key lifecycle** -- key changes break existing translations silently.

## Rules

- Restrict findings to changed frontend-facing code in the payload.
- Prioritize issues that block interaction or materially degrade accessibility outcomes.
- Avoid speculative style guidance unrelated to accessibility or localization behavior.
- Positive findings are encouraged when changes clearly improve inclusivity and localization safety.`;
}
