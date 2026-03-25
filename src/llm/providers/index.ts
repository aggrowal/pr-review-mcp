import {
  LlmProviderError,
  type LlmProvider,
  type LlmProviderConfig,
} from "../provider.js";

export function resolveProviderConfig(
  configured?: Partial<LlmProviderConfig>
): LlmProviderConfig {
  return {
    provider: configured?.provider ?? "anthropic",
    model: configured?.model,
    timeoutMs: configured?.timeoutMs ?? 45000,
    maxOutputTokens: configured?.maxOutputTokens,
    temperature: configured?.temperature,
  };
}

export function createProvider(_config: LlmProviderConfig): LlmProvider {
  throw new LlmProviderError(
    "request_failed",
    "Provider API execution has been retired. Use keyless staged pr_review validation flow."
  );
}
