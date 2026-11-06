// 자유 질문·답변 재현 API(설계서 §4.3·§4.4·§7, PHASES Phase 4 항목 4).
//   POST /api/v1/me/ask {question}  → 답변 파이프라인(llm/answer.ts). 예산(설계서 v0.1.27 §6.2 — llm/budget.ts): 사용자(ip 솔트 해시)·전역 1씩,
//                                     공급자는 폴백 체인(groq → workers-ai → openrouter)이 호출마다 1씩. 저하 모드 ①②③은 아래.
//   GET  /api/v1/answers/{id}       → 이 설계사의 answer_log 한 행(화면 7 답변 재현). LLM을 부르지 않는다 —
//                                     툴은 저장된 인자로 다시 실행해(읽기 전용·결정론) 결과와 resultHash 일치 여부를, 검색 청크는 본문을 붙인다.
// 저하 ①: 예산 소진(사용자·전역·시도할 공급자 전부) → LLM 없이 429 + BUDGET 고정 문구 + retryAfterSeconds(다음 00:00 UTC) — 거부도 answer_log에 남는다(§4.4).
// 순서(설계서 v0.1.29): 레이트 리밋(분당 3) → 답 단위 재사용(24시간 같은 키 — LLM·임베딩·예산 0) → 예산 → LLM(AI Gateway 경유).
// 저하 ②: 시도한 공급자가 모두 429·5xx·타임아웃 → 503. 저하 ③: 규정 검색 불가 → 툴만으로 답하고 rulesUnavailable·dataStatus DEGRADED.
import type { Context } from "hono";
import { Hono } from "hono";
import { rulebookChunks, type ScopedQuery } from "../db/ScopedQuery";
import { type AnswerResult, answerQuestion, cloudflareDeps, hash16, refuseWithoutLlm, reuseAnswer } from "../llm/answer";
import { anyProviderLeft, budgetCaps, countStat, reserveProvider, reserveQuestion, reserveRate, usageOn, userScope, utcDay, withKeys } from "../llm/budget";
import { fallbackChain, type GatewayRunner, groq, openrouter, ProviderError, ProvidersExhausted, traced, workersAi } from "../llm/providers";
import { type AppEnv, common, DISCLAIMER, invalidRequest, notFound, problem } from "./http";
import { InvalidToolCall, parseToolCall, runTool, serialize } from "../tools";
import { requireSession } from "./session";

const QUESTION_MAX = 500;
const ANSWER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 답변 응답은 질문마다 다르다 — 캐시하지 않는다(no-store). 공통 필드·고정 문구는 읽기 API와 같다. degraded면 dataStatus DEGRADED(저하 ③). */
function answerJson(c: Context<AppEnv>, body: object, status: 200 | 429 = 200, degraded = false): Response {
  return c.json({ ...common(c.get("scope")), ...(degraded ? { dataStatus: "DEGRADED" } : {}), ...body, disclaimer: DISCLAIMER }, status, { "Cache-Control": "no-store", Vary: "Cookie" });
}

/** 요청자 IP(Cloudflare가 붙이는 헤더). 없으면(로컬·시험) 한 묶음으로 센다. 원문은 userScope 안에서 해시만 남는다. */
export const clientIp = (c: Context<AppEnv>) => c.req.header("CF-Connecting-IP") ?? "local";

/** 다음 00:00 UTC까지 초(예산 카운터의 날 경계). */
export function secondsToUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((next - now.getTime()) / 1000);
}

/** POST /me/ask — me 라우터(세션 미들웨어 뒤)에 붙인다. */
export async function postAsk(c: Context<AppEnv>): Promise<Response> {
  const { q } = c.get("scope");
  const body = (await c.req.json().catch(() => null)) as { question?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question || question.length > QUESTION_MAX || Object.keys(body ?? {}).some((k) => k !== "question")) return invalidRequest(c);

  const now = new Date();
  const day = utcDay(now);
  const user = await userScope(c.env.SESSION_SECRET, clientIp(c), day);
  // 레이트 리밋(설계서 v0.1.29 §7 — 예산과 별도, 맨 앞): IP당 분당 3회. 넘으면 answer_log 없이 429 RATE_LIMITED + Retry-After(다음 분까지)
  const rate = await reserveRate(c.env.DB, user, now);
  if (!rate.ok) return problem(c, 429, "RATE_LIMITED", { "Retry-After": String(rate.retryAfterSeconds) });
  const caps = withKeys(budgetCaps(c.env), c.env);
  // AI Gateway(설계서 v0.1.29 §6.4): AI_GATEWAY_ID가 있을 때만 — 바인딩 gateway()는 실제로 부를 때 만든다
  const gwId = c.env.AI_GATEWAY_ID || null;
  const gw: GatewayRunner | null = gwId ? () => c.env.AI.gateway(gwId) : null;
  const providers = [groq(c.env, fetch, undefined, gw), workersAi(c.env.AI, gwId), openrouter(c.env, fetch, undefined, gw)];
  const chain = fallbackChain(providers, (name) => reserveProvider(c.env.DB, caps, name, day));
  const deps = cloudflareDeps(c.env, traced(chain, c.env, c.env.DB));
  const budgetRefusal = async () => {
    const b = await refuseWithoutLlm(deps, q, c.env, question, "BUDGET");
    await countStat(c.env.DB, "refuse:BUDGET", day);
    return answerJson(c, { answerId: b.answerId, refused: true, reason: "BUDGET", text: b.text, retryAfterSeconds: secondsToUtcMidnight(now), promptVersion: b.promptVersion }, 429);
  };
  // 답 단위 재사용 — 예산 검사보다 먼저(캐시 히트는 예산 미차감). 소진된 날에도 같은 질문의 원래 답은 돌려준다
  const reused = await reuseAnswer(deps, q, c.env, question);
  if (reused) {
    await countStat(c.env.DB, "cache:hit", day);
    return answerJson(c, answerBody(reused, true));
  }
  // 저하 ① — 시도할 공급자가 하나도 없으면 임베딩도 부르지 않는다(읽기만, 차감 없음 — 경합으로 그 뒤 소진되면 체인이 ProvidersExhausted)
  if (!anyProviderLeft(await usageOn(c.env.DB, caps, day))) return budgetRefusal();
  // 저하 ① — 사용자·전역(질문 1건에 1)
  if (!(await reserveQuestion(c.env.DB, caps, user, day)).ok) return budgetRefusal();
  let r: AnswerResult;
  try {
    r = await answerQuestion(deps, q, c.env, question);
  } catch (e) {
    // 저하 ① — 시도할 공급자가 모두 오늘 상한(Workers AI는 설명 배치 중 0)
    if (e instanceof ProvidersExhausted) return budgetRefusal();
    if (e instanceof ProviderError) {
      // 저하 ② — 시도한 공급자가 모두 실패(상태·메시지만 남긴다, 키·본문 없음)
      console.warn(`[ask] provider error ${e.status}: ${e.message}`);
      return problem(c, 503, "INTERNAL_ERROR");
    }
    throw e;
  }
  // 공개 /budget 분포(설계서 v0.1.28): 답한 공급자의 체인 순번·거부 사유·캐시(답 단위 — LLM을 불렀으면 miss)·저하 ③
  await Promise.all([
    countStat(c.env.DB, `depth:${Math.min(2, r.fallbackDepth) as 0 | 1 | 2}`, day),
    countStat(c.env.DB, "cache:miss", day),
    ...(r.refused && r.reason ? [countStat(c.env.DB, `refuse:${r.reason}`, day)] : []),
    ...(r.rulesUnavailable ? [countStat(c.env.DB, "degraded:rules", day)] : []),
  ]);
  return answerJson(c, answerBody(r, false), 200, r.rulesUnavailable);
}

function answerBody(r: AnswerResult, cacheHit: boolean) {
  return {
    answerId: r.answerId,
    refused: r.refused,
    reason: r.reason,
    text: r.text,
    numbersUsed: r.numbersUsed,
    citations: r.citations,
    toolCalls: r.toolCalls,
    provider: r.provider,
    model: r.model,
    promptVersion: r.promptVersion,
    groundingStatus: r.groundingStatus,
    cacheHit,
    latencyMs: r.latencyMs,
    fallbackDepth: r.fallbackDepth,
    // 저하 ③(설계서 v0.1.27): 규정 없이 툴만으로 답했다
    ...(r.rulesUnavailable ? { rulesUnavailable: true } : {}),
  };
}

const parseList = (s: unknown): unknown[] => {
  if (typeof s !== "string") return [];
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/** answer_log.violations → {g1Shape, g4Missing, g5Unknown, g6Words}(문자열 배열만), 없거나 모양이 다르면 null. g1Shape가 없는 행(v0.1.26 이전)은 []. */
function parseViolations(s: unknown): { g1Shape: string[]; g4Missing: string[]; g5Unknown: string[]; g6Words: string[] } | null {
  if (typeof s !== "string") return null;
  try {
    const v = JSON.parse(s) as Record<string, unknown>;
    const arr = (x: unknown) => (Array.isArray(x) && x.every((t) => typeof t === "string") ? (x as string[]) : null);
    const [g1Shape, g4Missing, g5Unknown, g6Words] = [v.g1Shape === undefined ? [] : arr(v.g1Shape), arr(v.g4Missing), arr(v.g5Unknown), arr(v.g6Words)];
    return g1Shape && g4Missing && g5Unknown && g6Words ? { g1Shape, g4Missing, g5Unknown, g6Words } : null;
  } catch {
    return null;
  }
}

interface LoggedToolCall {
  tool?: unknown;
  args?: unknown;
  resultHash?: unknown;
}

/**
 * 화면 7 재현(설계서 §7 "툴 결과"): 저장된 인자로 툴을 다시 실행한다 — 툴은 읽기 전용이고 같은 활성 스트림이면 결과가 같다.
 * reproduced = 지금 결과의 해시가 답변 때 resultHash와 같은가. 인자가 지금 검사를 통과하지 못하면 결과 없이 reproduced false.
 */
async function replayTools(q: ScopedQuery, logged: readonly unknown[]) {
  const out = [];
  for (const raw of logged) {
    const t = (raw ?? {}) as LoggedToolCall;
    const base = { tool: t.tool, args: t.args, resultHash: t.resultHash };
    try {
      const r = await runTool({ q }, parseToolCall({ tool: t.tool, args: t.args }));
      const now = await hash16(serialize(r.data));
      out.push({ ...base, result: r.data, truncated: r.truncated, reproduced: now === t.resultHash });
    } catch (e) {
      if (!(e instanceof InvalidToolCall)) throw e;
      out.push({ ...base, reproduced: false });
    }
  }
  return out;
}

/** GET /answers/{id} — 이 설계사 행만(남의 답변은 404). */
export const answers = new Hono<AppEnv>();
answers.use("*", requireSession);
answers.get("/:answerId", async (c) => {
  const id = c.req.param("answerId");
  if (!ANSWER_ID.test(id)) return notFound(c);
  const row = await c.get("scope").q.answerLog(id);
  if (!row) return notFound(c);
  const retrieved = parseList(row.retrieved_chunks).flatMap((x) => (Array.isArray(x) && typeof x[0] === "string" ? [{ chunkId: x[0], score: x[1] as unknown }] : []));
  // 본문은 visibility=agent 행만(rulebookChunks) — internal 청크는 재현 화면에도 나가지 않는다
  const bodies = new Map((await rulebookChunks(c.env.DB, retrieved.map((r) => r.chunkId))).map((r) => [r.chunk_id, r]));
  return answerJson(c, {
    answerId: row.answer_id,
    question: row.question,
    normalizedQuestion: row.normalized_question,
    answer: row.answer,
    refused: row.refused === 1,
    reason: row.refuse_reason,
    groundingStatus: row.grounding_status,
    numbersUsed: parseList(row.numbers_used),
    // 0006(설계서 v0.1.25): 위반 토큰 — 0006 이전 행은 null
    violations: parseViolations(row.violations),
    citations: parseList(row.citations),
    retrievedChunks: retrieved.map((r) => {
      const b = bodies.get(r.chunkId);
      return b ? { ...r, article: b.article, title: b.title, body: b.body, version: b.version } : r;
    }),
    toolCalls: await replayTools(c.get("scope").q, parseList(row.tool_calls)),
    promptVersion: row.prompt_version,
    provider: row.provider,
    model: row.model,
    fallbackDepth: row.fallback_depth,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
  });
});
