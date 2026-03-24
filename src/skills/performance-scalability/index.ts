import type { SkillMetadata, DiffContext, DetectedContext } from "../../types.js";

export const metadata: SkillMetadata = {
  id: "performance-scalability",
  name: "Performance & Scalability",
  description:
    "Algorithmic cost, query/IO amplification, hot-path allocations, and unbounded growth risks.",
  requires: {
    language: ["*"],
    framework: ["*"],
  },
  produces: "performance",
};

export function buildPrompt(_diff: DiffContext, ctx: DetectedContext): string {
  return `You are reviewing code for **performance and scalability** in a ${ctx.language} project.
Use the shared changed-files payload from the parent prompt.

## What to check

### A. Algorithmic Cost in Hot Paths

1. **Complexity regressions** -- O(n^2) or nested scans introduced in request or batch hot paths.
2. **Repeated full-collection work** -- sort/filter/map/reduce work repeated per item instead of precomputed once.
3. **Missing indexing/lookup strategy** -- linear scans where keyed lookup is available and clearer.
4. **Hot-path regex/parsing churn** -- expensive parsing repeatedly executed without caching/precompilation.

### B. Database and External IO Amplification

5. **N+1 query patterns** -- per-item DB/API calls instead of batched retrieval.
6. **Unbounded query payloads** -- missing pagination/limits for potentially large result sets.
7. **Synchronous fan-out without controls** -- parallel remote calls without concurrency bounds.
8. **Repeated remote lookups** -- same dependency call repeated within one request lifecycle.

### C. Memory and Allocation Pressure

9. **Excessive temporary allocations** -- avoidable clones, spreads, and intermediate arrays/objects.
10. **Large object retention** -- data kept alive longer than necessary in long-lived scopes.
11. **Serialization round-trips** -- parse/stringify cycles with no semantic gain.
12. **Inefficient string/byte handling** -- repeated concatenation or conversion in tight loops.

### D. Throughput and Concurrency Behavior

13. **Blocking work on latency-sensitive paths** -- CPU-heavy or file/network work in synchronous request handlers.
14. **Missing backpressure controls** -- producers can outrun consumers with unbounded in-memory buffering.
15. **Overly broad locks/critical sections** -- serialization of independent work that limits throughput.
16. **Work duplication across retries** -- same expensive operation re-run without dedupe/cache guard.

### E. Scalability Safety

17. **Unbounded in-process caches/maps** -- growth without TTL/eviction/size guard.
18. **Data-size assumptions** -- logic that only works for small collections.
19. **No cost guardrails** -- missing request size/depth/cardinality bounds.
20. **Performance-oblivious defaults** -- defaults that scale poorly under realistic load.

## Rules

- Prioritize findings that can materially impact latency, throughput, or resource consumption.
- Include concrete trigger scenarios (for example large input size, high QPS, fan-out count).
- Avoid speculative micro-optimizations with negligible impact.
- Positive findings are encouraged when changes reduce complexity or avoid amplification patterns.`;
}
