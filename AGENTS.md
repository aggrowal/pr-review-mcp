# Agent Context Guide

This file gives future agents a minimal entrypoint. Load only the referenced sections instead of the full docs when possible.

## Read Only What You Need

- For review output contract changes, read [Review contract enforcement](README.md#review-contract-enforcement).
- For prompt/token changes, read [Token efficiency strategy](README.md#token-efficiency-strategy).
- For skill format updates, read [Skill prompt format contract (must keep)](README.md#skill-prompt-format-contract-must-keep).
- For safety constraints, read [Prompt-injection hardening](README.md#prompt-injection-hardening).
- Before finalizing any behavior change, read [Future change checklist](README.md#future-change-checklist).

## High-Impact Files

- `src/prompt/assemble.ts`
  - Prompt assembly, track contract extraction, final report instructions, prompt telemetry.
- `src/index.ts`
  - Pipeline orchestration and execution/telemetry logging.
- `src/skills/*/index.ts`
  - Track checklists that must remain parseable.
- `tests/assembled-prompt.test.ts`
  - Prompt contract and telemetry expectations.
- `tests/skills-contract.test.ts`
  - Skill parseability constraints.
- `tests/prompt-assembly.test.ts`
  - End-to-end prompt contract presence.

## Editing Rules For Agents

1. Keep the review single-call flow (`pr_review`) unless explicitly requested otherwise.
2. Do not remove per-track/per-heading coverage requirements from final report instructions.
3. Preserve status taxonomy: `blocker | needs_improvement | nudge | looks_good`.
4. Keep skill headings in `### <Letter>. <Title>` and checks numbered.
5. Prefer token reductions via dedupe and concise language, not by dropping necessary context.

## Required Verification After Changes

- `npm test`
- `npm run build`

