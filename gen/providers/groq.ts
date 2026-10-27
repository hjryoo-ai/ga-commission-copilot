// Groq OpenAI 호환 Chat Completions(설계서 §10.2: 30 RPM · 1,000 RPD · 8K TPM · 200K TPD). SDK 없이 fetch 한 파일(§11).
import { loadEnv } from "./env.ts";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StructuredRequest {
  model: string;
  messages: ChatMessage[];
  schemaName: string;
  schema: object;
  maxCompletionTokens: number;
}

export interface StructuredResponse {
  json: unknown;
  model: string;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
}

export class ProviderError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(message: string, status: number, retryAfterSeconds: number | null) {
    super(message);
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** 공급자에 보내는 본문. VCR 요청 해시도 이 본문으로 만든다(같은 본문 = 같은 녹화). */
export function requestBody(req: StructuredRequest): object {
  return {
    model: req.model,
    messages: req.messages,
    temperature: 0,
    reasoning_effort: "low",
    max_completion_tokens: req.maxCompletionTokens,
    response_format: { type: "json_schema", json_schema: { name: req.schemaName, schema: req.schema, strict: true } },
  };
}

export async function groqStructured(req: StructuredRequest, timeoutMs = 60_000): Promise<StructuredResponse> {
  const key = loadEnv("GROQ_API_KEY");
  if (!key) throw new Error("GROQ_API_KEY가 gen/.dev.vars 또는 환경에 없다");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(requestBody(req)),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const retry = res.headers.get("retry-after");
    const text = (await res.text()).slice(0, 500);
    throw new ProviderError(`groq ${res.status}: ${text}`, res.status, retry ? Number(retry) : null);
  }
  const body = (await res.json()) as {
    model: string;
    usage?: StructuredResponse["usage"];
    choices: { message: { content: string | null } }[];
  };
  const content = body.choices[0]?.message.content;
  if (!content) throw new ProviderError("groq: 빈 응답", 502, null);
  return { json: JSON.parse(content), model: body.model, usage: body.usage ?? null };
}
