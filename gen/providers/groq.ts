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
  /** Workers AI는 neurons도 준다(설계서 §10.1 호출당 뉴런 실측). */
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; neurons?: number } | null;
}

export class ProviderError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  /** HTTP는 성공했는데 본문이 비었거나 JSON이 아님(구조화 출력 실패와 같게 다룬다). */
  readonly badContent: boolean;

  constructor(message: string, status: number, retryAfterSeconds: number | null, badContent = false) {
    super(message);
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.badContent = badContent;
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

/** 응답 본문 → JSON. 코드 울타리(```json … ```) 하나로 감싼 출력도 받는다(프롬프트 강제 JSON 모드). */
export function parseContent(content: string): unknown {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(content);
  return JSON.parse(fenced ? fenced[1]! : content);
}

/**
 * responseFormat: false면 response_format을 빼고 보낸다 — 공급자가 json_schema를 거부할 때의 폴백(프롬프트 강제 JSON + 호출자의 G1).
 * VCR 해시는 requestBody(req) 그대로라 폴백이 녹화 키를 바꾸지 않는다.
 */
export async function structured(provider: ProviderName, req: StructuredRequest, timeoutMs = 60_000, opts: { responseFormat?: boolean } = {}): Promise<StructuredResponse> {
  const { url, key } = endpointOf(provider);
  const { response_format, ...rest } = requestBody(req) as Record<string, unknown>;
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(opts.responseFormat === false ? rest : { ...rest, response_format }),
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
  if (!content) throw new ProviderError(`${provider}: 빈 응답`, 502, null, true);
  let json: unknown;
  try {
    json = parseContent(content);
  } catch {
    throw new ProviderError(`${provider}: JSON 아님 ${content.slice(0, 200)}`, 502, null, true);
  }
  return { json, model: body.model, usage: body.usage ?? null };
}
