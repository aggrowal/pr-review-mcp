import {
  LlmProviderError,
  fetchJsonWithTimeout,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from "../provider.js";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4.1-mini";

interface OpenAiResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

export class OpenAiProvider implements LlmProvider {
  readonly id = "openai" as const;
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
      response_format: { type: "json_object" },
      temperature: request.temperature ?? this.defaultTemperature ?? 0,
      max_tokens: request.maxOutputTokens ?? this.defaultMaxOutputTokens,
      messages: [
        ...(request.systemPrompt
          ? [{ role: "system" as const, content: request.systemPrompt }]
          : []),
        { role: "user" as const, content: request.prompt },
      ],
    };

    const { status, body } = await fetchJsonWithTimeout(
      OPENAI_API_URL,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
      },
      request.timeoutMs || this.timeoutMs
    );

    if (status < 200 || status >= 300) {
      const errorBody = body as OpenAiResponse;
      throw new LlmProviderError(
        "request_failed",
        `OpenAI request failed with status ${status}.`,
        {
          retryable: status >= 500 || status === 429,
          detail: errorBody.error?.message ?? JSON.stringify(body),
        }
      );
    }

    const data = body as OpenAiResponse;
    const text = data.choices?.[0]?.message?.content?.trim();

    if (!text) {
      throw new LlmProviderError(
        "invalid_response",
        "OpenAI response did not include message content.",
        { detail: JSON.stringify(body) }
      );
    }

    return {
      provider: this.id,
      model: this.model,
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
    };
  }
}
