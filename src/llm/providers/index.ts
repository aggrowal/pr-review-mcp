import {
  LlmProviderError,
  type LlmProvider,
  type LlmProviderConfig,
  type LlmProviderId,
} from "../provider.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAiProvider } from "./openai.js";

export function resolveProviderConfig(
  configured?: Partial<LlmProviderConfig>
): LlmProviderConfig {
  const provider = resolveProviderId(
    process.env.PR_REVIEW_PROVIDER,
    configured?.provider
  );

  return {
    provider,
    model: process.env.PR_REVIEW_MODEL ?? configured?.model,
    timeoutMs:
      parseNumberEnv(process.env.PR_REVIEW_TIMEOUT_MS) ??
      configured?.timeoutMs ??
      45000,
    maxOutputTokens:
      parseNumberEnv(process.env.PR_REVIEW_MAX_OUTPUT_TOKENS) ??
      configured?.maxOutputTokens,
    temperature:
      parseNumberEnv(process.env.PR_REVIEW_TEMPERATURE) ??
      configured?.temperature,
  };
}

export function createProvider(config: LlmProviderConfig): LlmProvider {
  if (config.provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new LlmProviderError(
        "auth_missing",
        "ANTHROPIC_API_KEY is required when provider=anthropic."
      );
    }
    return new AnthropicProvider({
      apiKey,
      model: config.model,
      timeoutMs: config.timeoutMs,
      maxOutputTokens: config.maxOutputTokens,
      temperature: config.temperature,
    });
  }

  if (config.provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new LlmProviderError(
        "auth_missing",
        "OPENAI_API_KEY is required when provider=openai."
      );
    }
    return new OpenAiProvider({
      apiKey,
      model: config.model,
      timeoutMs: config.timeoutMs,
      maxOutputTokens: config.maxOutputTokens,
      temperature: config.temperature,
    });
  }

  throw new LlmProviderError(
    "request_failed",
    `Unsupported provider "${String(config.provider)}".`
  );
}

function resolveProviderId(
  envProvider: string | undefined,
  configuredProvider: LlmProviderId | undefined
): LlmProviderId {
  const candidate = (envProvider ?? configuredProvider ?? "anthropic").trim();
  if (candidate === "anthropic" || candidate === "openai") {
    return candidate;
  }
  throw new LlmProviderError(
    "request_failed",
    `Unsupported provider "${candidate}". Expected "anthropic" or "openai".`
  );
}

function parseNumberEnv(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}
