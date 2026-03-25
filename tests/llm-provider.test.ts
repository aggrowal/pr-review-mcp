import { afterEach, describe, expect, it } from "vitest";
import { createProvider, resolveProviderConfig } from "../src/llm/providers/index.js";
import { LlmProviderError } from "../src/llm/provider.js";

const ENV_KEYS = [
  "PR_REVIEW_PROVIDER",
  "PR_REVIEW_MODEL",
] as const;

const ORIGINAL_ENV: Record<(typeof ENV_KEYS)[number], string | undefined> = {
  PR_REVIEW_PROVIDER: process.env.PR_REVIEW_PROVIDER,
  PR_REVIEW_MODEL: process.env.PR_REVIEW_MODEL,
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
  it("keeps configured values and no longer reads runtime env overrides", () => {
    const resolved = resolveProviderConfig({
      provider: "openai",
      timeoutMs: 30000,
      model: "gpt-test",
      maxOutputTokens: 2048,
      temperature: 0.1,
    });

    expect(resolved.provider).toBe("openai");
    expect(resolved.timeoutMs).toBe(30000);
    expect(resolved.model).toBe("gpt-test");
    expect(resolved.maxOutputTokens).toBe(2048);
    expect(resolved.temperature).toBe(0.1);
  });
});

describe("createProvider", () => {
  it("throws request_failed because provider execution is retired", () => {
    expect(() => createProvider({ provider: "openai" })).toThrow(LlmProviderError);
    expect(() => createProvider({ provider: "openai" })).toThrow(
      /retired/i
    );
  });
});
