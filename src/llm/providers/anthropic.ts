import {
  LlmProviderError,
  fetchJsonWithTimeout,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from "../provider.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-3-5-sonnet-latest";

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

export class AnthropicProvider implements LlmProvider {
  readonly id = "anthropic" as const;
  readonly model: string;
  private apiKey: string;
  private timeoutMs: number;
  private defaultMaxOutputTokens?: number;
  private defaultTemperature?: number;

  constructor(options: {
    apiKey: string;
    model?: string;
    timeoutMs?: number;
    maxOutputTokens?: number;
    temperature?: number;
  }) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? 45000;
    this.defaultMaxOutputTokens = options.maxOutputTokens;
    this.defaultTemperature = options.temperature;
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    const payload = {
      model: this.model,
      max_tokens: request.maxOutputTokens ?? this.defaultMaxOutputTokens ?? 4096,
      temperature: request.temperature ?? this.defaultTemperature ?? 0,
      system: request.systemPrompt,
      messages: [
        {
          role: "user",
          content: request.prompt,
        },
      ],
    };

    const { status, body } = await fetchJsonWithTimeout(
      ANTHROPIC_API_URL,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(payload),
      },
      request.timeoutMs || this.timeoutMs
    );

    if (status < 200 || status >= 300) {
      const errorBody = body as AnthropicResponse;
      throw new LlmProviderError(
        "request_failed",
        `Anthropic request failed with status ${status}.`,
        {
          retryable: status >= 500 || status === 429,
          detail: errorBody.error?.message ?? JSON.stringify(body),
        }
      );
    }

    const data = body as AnthropicResponse;
    const text = (data.content ?? [])
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text as string)
      .join("\n")
      .trim();

    if (!text) {
      throw new LlmProviderError(
        "invalid_response",
        "Anthropic response did not include text content.",
        { detail: JSON.stringify(body) }
      );
    }

    return {
      provider: this.id,
      model: this.model,
      text,
      usage: {
        inputTokens: data.usage?.input_tokens,
        outputTokens: data.usage?.output_tokens,
        totalTokens:
          (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      },
    };
  }
}
