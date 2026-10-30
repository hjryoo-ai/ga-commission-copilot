// OpenAI 호환 Chat Completions 구조화 출력. SDK 없이 fetch 한 파일(§11).
// - groq: 설계서 §10.2 30 RPM · 1,000 RPD · 8K TPM · 200K TPD
// - workers-ai: Cloudflare REST의 OpenAI 호환 엔드포인트(설계서 v0.1.14 §4.1(b) 설명 배치 — @cf/openai/gpt-oss-20b, 10,000뉴런/일).
//   키는 gen/.dev.vars의 CLOUDFLARE_API_TOKEN(Workers AI 권한)·CLOUDFLARE_ACCOUNT_ID — 커밋 금지(규약 10).
import { loadEnv } from "./env.ts";

export type ProviderName = "groq" | "workers-ai";

/** 공급자별 엔드포인트·키. 모델은 프롬프트 model_hint 또는 호출자가 고른다. */
function endpointOf(provider: ProviderName): { url: string; key: string } {
  if (provider === "groq") {
    const key = loadEnv("GROQ_API_KEY");
    if (!key) throw new Error("GROQ_API_KEY가 gen/.dev.vars 또는 환경에 없다");
    return { url: "https://api.groq.com/openai/v1/chat/completions", key };
  }
  const key = loadEnv("CLOUDFLARE_API_TOKEN");
  const account = loadEnv("CLOUDFLARE_ACCOUNT_ID");
  if (!key || !account) throw new Error("CLOUDFLARE_API_TOKEN·CLOUDFLARE_ACCOUNT_ID가 gen/.dev.vars 또는 환경에 없다(Workers AI 설명 배치)");
  return { url: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/chat/completions`, key };
}

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
  return structured("groq", req, timeoutMs);
}

export async function structured(provider: ProviderName, req: StructuredRequest, timeoutMs = 60_000): Promise<StructuredResponse> {
  const { url, key } = endpointOf(provider);
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(requestBody(req)),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const retry = res.headers.get("retry-after");
    const text = (await res.text()).slice(0, 500);
    throw new ProviderError(`${provider} ${res.status}: ${text}`, res.status, retry ? Number(retry) : null);
  }
  const body = (await res.json()) as {
    model: string;
    usage?: StructuredResponse["usage"];
    choices: { message: { content: string | null } }[];
  };
  const content = body.choices[0]?.message.content;
  if (!content) throw new ProviderError(`${provider}: 빈 응답`, 502, null);
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    throw new ProviderError(`${provider}: JSON 아님 ${content.slice(0, 200)}`, 502, null);
  }
  return { json, model: body.model, usage: body.usage ?? null };
}
