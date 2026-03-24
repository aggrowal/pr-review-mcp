import { afterEach, describe, expect, it } from "vitest";
import { createProvider, resolveProviderConfig } from "../src/llm/providers/index.js";
import { LlmProviderError } from "../src/llm/provider.js";

const ENV_KEYS = [
  "PR_REVIEW_PROVIDER",
  "PR_REVIEW_MODEL",
  "PR_REVIEW_TIMEOUT_MS",
  "PR_REVIEW_MAX_OUTPUT_TOKENS",
  "PR_REVIEW_TEMPERATURE",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
] as const;

const ORIGINAL_ENV: Record<(typeof ENV_KEYS)[number], string | undefined> = {
  PR_REVIEW_PROVIDER: process.env.PR_REVIEW_PROVIDER,
  PR_REVIEW_MODEL: process.env.PR_REVIEW_MODEL,
  PR_REVIEW_TIMEOUT_MS: process.env.PR_REVIEW_TIMEOUT_MS,
  PR_REVIEW_MAX_OUTPUT_TOKENS: process.env.PR_REVIEW_MAX_OUTPUT_TOKENS,
  PR_REVIEW_TEMPERATURE: process.env.PR_REVIEW_TEMPERATURE,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
});

describe("llm provider configuration", () => {
  it("uses config defaults when env is not set", () => {
    delete process.env.PR_REVIEW_PROVIDER;
    delete process.env.PR_REVIEW_TIMEOUT_MS;

    const resolved = resolveProviderConfig({
      provider: "openai",
      timeoutMs: 30000,
      model: "gpt-test",
    });

    expect(resolved.provider).toBe("openai");
    expect(resolved.timeoutMs).toBe(30000);
    expect(resolved.model).toBe("gpt-test");
  });

  it("allows env to override configured provider options", () => {
    process.env.PR_REVIEW_PROVIDER = "openai";
    process.env.PR_REVIEW_MODEL = "gpt-4.1";
    process.env.PR_REVIEW_TIMEOUT_MS = "25000";
    process.env.PR_REVIEW_MAX_OUTPUT_TOKENS = "2048";
    process.env.PR_REVIEW_TEMPERATURE = "0.2";

    const resolved = resolveProviderConfig({
      provider: "anthropic",
      timeoutMs: 45000,
      model: "claude-test",
    });

    expect(resolved.provider).toBe("openai");
    expect(resolved.model).toBe("gpt-4.1");
    expect(resolved.timeoutMs).toBe(25000);
    expect(resolved.maxOutputTokens).toBe(2048);
    expect(resolved.temperature).toBe(0.2);
  });

  it("throws for unsupported provider ids", () => {
    process.env.PR_REVIEW_PROVIDER = "unsupported-provider";
    expect(() => resolveProviderConfig()).toThrow(LlmProviderError);
  });
});

describe("createProvider", () => {
  it("throws auth_missing for missing anthropic key", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() =>
      createProvider({
        provider: "anthropic",
      })
    ).toThrowError(/ANTHROPIC_API_KEY/);
  });

  it("throws auth_missing for missing openai key", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() =>
      createProvider({
        provider: "openai",
      })
    ).toThrowError(/OPENAI_API_KEY/);
  });

  it("creates anthropic provider when key is set", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const provider = createProvider({
      provider: "anthropic",
    });
    expect(provider.id).toBe("anthropic");
  });

  it("creates openai provider when key is set", () => {
    process.env.OPENAI_API_KEY = "test-key";
    const provider = createProvider({
      provider: "openai",
    });
    expect(provider.id).toBe("openai");
  });
});
