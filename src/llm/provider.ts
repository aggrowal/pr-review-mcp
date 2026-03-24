export type LlmProviderId = "anthropic" | "openai";

export interface LlmRequest {
  prompt: string;
  systemPrompt?: string;
  timeoutMs: number;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface LlmResponse {
  provider: LlmProviderId;
  model: string;
  text: string;
  usage?: LlmUsage;
}

export interface LlmProvider {
  readonly id: LlmProviderId;
  readonly model: string;
  generate(request: LlmRequest): Promise<LlmResponse>;
}

export interface LlmProviderConfig {
  provider: LlmProviderId;
  model?: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  temperature?: number;
}

export type LlmProviderErrorCode =
  | "auth_missing"
  | "request_failed"
  | "timeout"
  | "invalid_response";

export class LlmProviderError extends Error {
  readonly code: LlmProviderErrorCode;
  readonly retryable: boolean;
  readonly detail?: string;

  constructor(
    code: LlmProviderErrorCode,
    message: string,
    options?: { retryable?: boolean; detail?: string }
  ) {
    super(message);
    this.name = "LlmProviderError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.detail = options?.detail;
  }
}

export async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    return {
      status: response.status,
      body,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new LlmProviderError(
        "timeout",
        `LLM request timed out after ${timeoutMs}ms.`,
        { retryable: true }
      );
    }
    throw new LlmProviderError("request_failed", "LLM request failed.", {
      retryable: true,
      detail: String(error),
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}
