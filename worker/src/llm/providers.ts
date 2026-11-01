// 런타임 LLM 공급자(설계서 §4.3·§6.2·§10.2, PHASES Phase 4 항목 3 — Phase 4는 Groq만, 폴백 체인은 Phase 5).
// OpenAI 호환 Chat Completions를 fetch 한 번으로(SDK 없음, §11), 8초 타임아웃. 요청 본문은 gen/providers/groq.ts requestBody와 같은 모양(temperature 0·reasoning_effort low·json_schema strict).
// 키는 wrangler secret GROQ_API_KEY(규약 10). 값은 로그·응답에 남기지 않는다.

export type ProviderName = "groq";

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
  provider: ProviderName;
  model: string;
  usage: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/** 공급자 오류. status 429·5xx·0(타임아웃·네트워크)은 Phase 5 폴백 대상, 그 밖은 요청 문제. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterS: number | null = null,
  ) {
    super(message);
  }
}

export interface Provider {
  readonly name: ProviderName;
  structured(req: StructuredRequest): Promise<StructuredResponse>;
}

export const TIMEOUT_MS = 8_000;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

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

/** 본문 → JSON. 코드 울타리 하나로 감싼 출력도 받는다. */
export function parseContent(content: string): unknown {
  const fenced = content.match(/^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/);
  return JSON.parse(fenced ? fenced[1]! : content);
}

export function groq(env: Pick<Env, "GROQ_API_KEY">, fetcher: typeof fetch = fetch): Provider {
  return {
    name: "groq",
    async structured(req) {
      const key = env.GROQ_API_KEY;
      if (!key) throw new ProviderError("GROQ_API_KEY 없음", 0);
      let res: Response;
      try {
        res = await fetcher(GROQ_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify(requestBody(req)),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        throw new ProviderError(`groq: ${(e as Error).name === "TimeoutError" ? `${TIMEOUT_MS}ms 타임아웃` : "네트워크 오류"}`, 0);
      }
      if (!res.ok) {
        const retry = res.headers.get("retry-after");
        throw new ProviderError(`groq ${res.status}`, res.status, retry ? Number(retry) : null);
      }
      const body = (await res.json()) as { model: string; usage?: StructuredResponse["usage"]; choices: { message: { content: string | null } }[] };
      const content = body.choices[0]?.message.content;
      if (!content) throw new ProviderError("groq: 빈 응답", 502);
      let json: unknown;
      try {
        json = parseContent(content);
      } catch {
        throw new ProviderError("groq: JSON 아님", 502);
      }
      return { json, provider: "groq", model: body.model, usage: body.usage ?? null };
    },
  };
}
