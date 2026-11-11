// 런타임 LLM 공급자(설계서 §4.3·§6.2·§10.2, PHASES Phase 4 항목 3·Phase 5 항목 2). 폴백 체인 groq → workers-ai → openrouter(v0.1.27).
// OpenAI 호환 Chat Completions를 fetch 한 번으로(SDK 없음, §11), 8초 타임아웃. 요청 본문은 gen/providers/groq.ts requestBody와 같은 모양(temperature 0·reasoning_effort low·json_schema strict).
// 키는 wrangler secret GROQ_API_KEY(규약 10). 값은 로그·응답에 남기지 않는다.
// AI Gateway(설계서 v0.1.29 §6.4): AI_GATEWAY_ID가 있으면 Groq·OpenRouter는 AI 바인딩 gateway(id).run()(유니버설 요청 — 바인딩이 인증,
// 계정 ID·게이트웨이 토큰 없음), Workers AI는 run(…, {gateway}). 캐시 키는 요청의 cacheKey(requestBody 밖 — 카세트 해시가 바뀌지 않는다), TTL 24시간.
// 게이트웨이 자체 오류(던짐·게이트웨이 형식 오류 본문·404 경로)면 그 공급자를 직접 한 번 더 — 게이트웨이 설정 때문에 /ask가 멈추지 않게.
// LLM_TRACE=1(로컬 .dev.vars 전용)이면 traced()가 원문 요청·응답을 D1 llm_trace에 쓴다 — 답변 VCR 녹화(운영자 2026-11-01). 원격에는 그 env가 없다.
import { insertLlmTrace } from "../db/ScopedQuery";

export type ProviderName = "groq" | "workers-ai" | "openrouter";

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
  /** AI Gateway 캐시 키(설계서 v0.1.29) — requestBody·requestHash에 넣지 않는다. 없으면 게이트웨이 기본 키(요청 본문). */
  cacheKey?: string;
}

export interface StructuredResponse {
  json: unknown;
  provider: ProviderName;
  model: string;
  usage: { prompt_tokens?: number; completion_tokens?: number } | null;
  /** 폴백 체인에서 답한 공급자의 순번(0 = groq, 1 = workers-ai, 2 = openrouter — answer_log.fallback_depth). 체인 밖 단일 공급자는 없음. */
  fallbackDepth?: number;
  /** 게이트웨이 응답 헤더 cf-aig-cache-status(HIT·MISS) — 게이트웨이를 거치지 않았으면 없음. */
  gatewayCache?: string;
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
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/** 설계서 §6.2·D-7: 폴백 모델. Groq 모델 이름(프롬프트 model_hint)을 공급자별 이름으로 바꾼다. */
export const WORKERS_AI_MODEL = "@cf/openai/gpt-oss-120b";
export const OPENROUTER_MODEL = "openrouter/free";
/** 설계서 §6.4: 게이트웨이 캐시 24시간. */
export const GATEWAY_CACHE_TTL_S = 86_400;

/** gateway(id).run만 쓴다(시험은 가짜). 부를 때 만든다 — 게이트웨이를 안 쓰는 경로(시험·로컬)는 바인딩을 건드리지 않는다. */
export type GatewayRunner = () => Pick<AiGateway, "run">;

/** 게이트웨이 자체 오류 본문({success:false, error:[{code,message}]} — Cloudflare API 형식, 2026-11-06 점검의 401 code 2009). 공급자 오류 본문(error가 객체)과 다르다. */
async function isGatewayErrorBody(res: Response): Promise<boolean> {
  try {
    const b = (await res.clone().json()) as { success?: unknown; error?: unknown };
    return b.success === false && Array.isArray(b.error);
  } catch {
    return false;
  }
}

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

/** 본문 문자열 → JSON(빈 본문·JSON 아님은 502 — 폴백 대상). */
function jsonOf(name: ProviderName, content: string | null | undefined): unknown {
  if (!content) throw new ProviderError(`${name}: 빈 응답`, 502);
  try {
    return parseContent(content);
  } catch {
    throw new ProviderError(`${name}: JSON 아님`, 502);
  }
}

/** OpenAI 호환 Chat Completions(Groq·OpenRouter). url은 AI Gateway 경유 URL로 바꿀 수 있다(Phase 5 항목 3). */
function openAiCompatible(
  name: "groq" | "openrouter",
  url: string,
  key: string | undefined,
  model: string | null,
  fetcher: typeof fetch,
  headers: Record<string, string> = {},
  gateway: GatewayRunner | null = null,
): Provider {
  return {
    name,
    async structured(req) {
      if (!key) throw new ProviderError(`${name}: 키 없음`, 0);
      const body = model ? { ...requestBody(req), model } : requestBody(req);
      const hdrs = { authorization: `Bearer ${key}`, "content-type": "application/json", ...headers };
      const failed = (e: unknown) => new ProviderError(`${name}: ${(e as Error).name === "TimeoutError" ? `${TIMEOUT_MS}ms 타임아웃` : "네트워크 오류"}`, 0);
      const direct = async () => {
        try {
          return await fetcher(url, { method: "POST", headers: hdrs, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
        } catch (e) {
          throw failed(e);
        }
      };
      let res: Response | null = null;
      if (gateway) {
        const cache = req.cacheKey ? { "cf-aig-cache-key": req.cacheKey, "cf-aig-cache-ttl": GATEWAY_CACHE_TTL_S } : {};
        try {
          res = await gateway().run({ provider: name, endpoint: "chat/completions", headers: { ...hdrs, ...cache }, query: body }, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        } catch (e) {
          if ((e as Error).name === "TimeoutError") throw failed(e);
          console.warn(`[gateway] ${name} 게이트웨이 오류 — 직접 1회: ${String((e as Error).message).slice(0, 120)}`);
        }
        if (res && !res.ok && (res.status === 404 || (await isGatewayErrorBody(res)))) {
          console.warn(`[gateway] ${name} 게이트웨이 ${res.status} — 직접 1회`);
          res = null;
        }
      }
      res ??= await direct();
      if (!res.ok) {
        const retry = res.headers.get("retry-after");
        throw new ProviderError(`${name} ${res.status}`, res.status, retry ? Number(retry) : null);
      }
      const b = (await res.json()) as { model: string; usage?: StructuredResponse["usage"]; choices: { message: { content: string | null } }[] };
      const cacheStatus = res.headers.get("cf-aig-cache-status");
      return { json: jsonOf(name, b.choices[0]?.message.content), provider: name, model: b.model, usage: b.usage ?? null, ...(cacheStatus ? { gatewayCache: cacheStatus } : {}) };
    },
  };
}

export function groq(env: Pick<Env, "GROQ_API_KEY">, fetcher: typeof fetch = fetch, url = GROQ_URL, gateway: GatewayRunner | null = null): Provider {
  return openAiCompatible("groq", url, env.GROQ_API_KEY, null, fetcher, {}, gateway);
}

/** 설계서 §6.2 3순위 — OpenRouter 무료 라우터. 키는 wrangler secret OPENROUTER_API_KEY(규약 10). */
export function openrouter(env: Pick<Env, "OPENROUTER_API_KEY">, fetcher: typeof fetch = fetch, url = OPENROUTER_URL, gateway: GatewayRunner | null = null): Provider {
  return openAiCompatible("openrouter", url, env.OPENROUTER_API_KEY, OPENROUTER_MODEL, fetcher, { "x-title": "ga-commission-copilot" }, gateway);
}

/** Workers AI 결과의 본문 — 문서가 응답 모양을 밝히지 않아(2026-11-06 확인) OpenAI 모양(choices)과 네이티브 모양(response) 둘 다 받는다. 실호출 확인은 폴백 상한이 열리는 11-08 뒤. */
export function workersAiContent(r: unknown): { json: unknown; usage: StructuredResponse["usage"] } {
  const o = (r ?? {}) as { choices?: { message?: { content?: string | null } }[]; response?: unknown; usage?: StructuredResponse["usage"] };
  if (Array.isArray(o.choices)) return { json: jsonOf("workers-ai", o.choices[0]?.message?.content), usage: o.usage ?? null };
  if (typeof o.response === "string") return { json: jsonOf("workers-ai", o.response), usage: o.usage ?? null };
  if (o.response && typeof o.response === "object") return { json: o.response, usage: o.usage ?? null };
  throw new ProviderError("workers-ai: 알 수 없는 응답 모양", 502);
}

/** 설계서 §6.2 2순위 — AI 바인딩(@cf/openai/gpt-oss-120b). 하루 뉴런 소진(3036·4006)은 429로 바꿔 체인이 다음으로 넘어가게 한다. */
/** AI 바인딩이 던진 게이트웨이 자체 오류(이름·메시지에 gateway) — 모델 오류(3036·4006 등)와 가른다. */
const isGatewayError = (e: unknown) => /gateway/i.test(`${(e as Error)?.name ?? ""} ${(e as Error)?.message ?? ""}`) && !/\b(3036|4006)\b|neurons/i.test((e as Error)?.message ?? "");

export function workersAi(ai: Pick<Ai, "run">, gatewayId: string | null = null): Provider {
  return {
    name: "workers-ai",
    async structured(req) {
      let r: unknown;
      const run = ai.run as unknown as (model: string, input: object, opts?: object) => Promise<unknown>;
      const input = {
        messages: req.messages,
        temperature: 0,
        max_tokens: req.maxCompletionTokens,
        response_format: { type: "json_schema", json_schema: { name: req.schemaName, schema: req.schema, strict: true } },
      };
      const once = (opts?: object) =>
        Promise.race([run(WORKERS_AI_MODEL, input, opts), new Promise((_, reject) => setTimeout(() => reject(new ProviderError(`workers-ai: ${TIMEOUT_MS}ms 타임아웃`, 0)), TIMEOUT_MS))]);
      try {
        if (!gatewayId) r = await once();
        else {
          try {
            r = await once({ gateway: { id: gatewayId, cacheTtl: GATEWAY_CACHE_TTL_S, ...(req.cacheKey ? { cacheKey: req.cacheKey } : {}) } });
          } catch (e) {
            if (!isGatewayError(e)) throw e;
            console.warn(`[gateway] workers-ai 게이트웨이 오류 — 직접 1회: ${String((e as Error).message).slice(0, 120)}`);
            r = await once();
          }
        }
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        const m = (e as Error).message ?? "";
        throw new ProviderError(`workers-ai: ${m.slice(0, 200)}`, /\b(3036|4006)\b|neurons|rate limit/i.test(m) ? 429 : 502);
      }
      const { json, usage } = workersAiContent(r);
      return { json, provider: "workers-ai", model: WORKERS_AI_MODEL, usage };
    },
  };
}

/** 폴백 체인에서 시도할 공급자가 하나도 없다(모두 상한 0 또는 그날 소진) — 저하 ①(429 BUDGET). */
export class ProvidersExhausted extends Error {}

/** 429·5xx·0(타임아웃·네트워크)만 다음 공급자로(설계서 §6.2). 그 밖의 4xx는 요청 문제라 그대로 던진다. */
export const isFallbackable = (e: ProviderError) => e.status === 0 || e.status === 429 || e.status >= 500;

/**
 * 실패 종류(설계서 v0.1.34 §6.2 저하 ② — stat:err:<공급자>:<종류>). 키·본문·메시지는 남기지 않고 종류만.
 * Workers AI 바인딩 오류에 4자리 코드(5006 입력 검증 등)가 있으면 ai_<코드> — Workers Logs 없이 D1로 원인을 가른다.
 */
export function failureKind(e: ProviderError): string {
  const m = e.message;
  if (e.status === 429) return "rate_limit";
  if (/타임아웃/.test(m)) return "timeout";
  if (/빈 응답/.test(m)) return "empty";
  if (/JSON 아님/.test(m)) return "not_json";
  if (/응답 모양/.test(m)) return "shape";
  if (/gateway/i.test(m)) return "gateway";
  const code = m.match(/^workers-ai: .*?\b([0-9]{4})\b/)?.[1];
  if (code) return `ai_${code}`;
  if (e.status >= 500) return "upstream";
  return "other";
}

/** 체인 안 한 번의 시도(실패) — 공급자·체인 순번·모델·종류. */
export interface FailedAttempt {
  provider: ProviderName;
  depth: number;
  model: string;
  kind: string;
}

/** 시도한 공급자가 모두 실패(저하 ②) — 마지막 오류의 status·message에 시도 목록을 붙인다. ask.ts가 PROVIDER_ERROR 행을 남긴다. */
export class ProvidersFailed extends ProviderError {
  constructor(
    last: ProviderError,
    readonly attempts: readonly FailedAttempt[],
  ) {
    super(last.message, last.status, last.retryAfterS);
  }
}

const modelOf = (name: ProviderName, reqModel: string) => (name === "workers-ai" ? WORKERS_AI_MODEL : name === "openrouter" ? OPENROUTER_MODEL : reqModel);

/**
 * 설계서 v0.1.27 §6.2 폴백 체인: 순서대로, reserve(공급자 예산 1 차감)가 거절하면 시도에 넣지 않고 건너뛴다.
 * 실제 시도는 최대 maxAttempts(2)개 — 실패 요청도 공급자 RPD를 쓰므로. 답한 공급자의 체인 순번을 fallbackDepth로.
 */
export function fallbackChain(providers: readonly Provider[], reserve: (name: ProviderName) => Promise<boolean>, maxAttempts = 2): Provider {
  return {
    name: providers[0]!.name,
    async structured(req) {
      const failed: FailedAttempt[] = [];
      let last: ProviderError | null = null;
      for (const [i, p] of providers.entries()) {
        if (failed.length >= maxAttempts) break;
        if (!(await reserve(p.name))) continue;
        try {
          return { ...(await p.structured(req)), fallbackDepth: i };
        } catch (e) {
          if (!(e instanceof ProviderError)) throw e;
          failed.push({ provider: p.name, depth: i, model: modelOf(p.name, req.model), kind: failureKind(e) });
          console.warn(`[fallback] ${p.name} ${e.status} ${failureKind(e)}: ${e.message}`);
          // 4xx(요청 문제)는 다음 공급자로 넘기지 않는다 — 그래도 행은 남기게 시도 목록과 함께
          if (!isFallbackable(e)) throw new ProvidersFailed(e, failed);
          last = e;
        }
      }
      if (failed.length === 0) throw new ProvidersExhausted("시도할 공급자 없음 — 모두 오늘 상한");
      throw new ProvidersFailed(last!, failed);
    },
  };
}

/** 키를 정렬한 JSON(카세트 키가 속성 순서에 흔들리지 않게). */
function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/** 요청 해시 = requestBody 정규 JSON의 SHA-256 16진(답변 카세트 키 — 같은 프롬프트·컨텍스트·툴 결과 = 같은 녹화). */
export async function requestHash(req: StructuredRequest): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(requestBody(req))));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 로컬 녹화: LLM_TRACE === "1"일 때만 성공한 호출의 원문을 llm_trace에 쓴다. 그 밖에는 공급자를 그대로 돌려준다. */
export function traced(p: Provider, env: { LLM_TRACE?: string }, db: D1Database): Provider {
  if (env.LLM_TRACE === "1") {
    return {
      name: p.name,
      async structured(req) {
        const r = await p.structured(req);
        await insertLlmTrace(db, {
          traceId: crypto.randomUUID(),
          requestHash: await requestHash(req),
          provider: r.provider,
          model: r.model,
          request: JSON.stringify(requestBody(req)),
          response: JSON.stringify({ json: r.json, model: r.model, usage: r.usage }),
          createdAt: new Date().toISOString(),
        });
        return r;
      },
    };
  }
  return p;
}
