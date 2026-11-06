// 자유 질문·답변 재현 API(설계서 §4.3·§4.4·§7, PHASES Phase 4 항목 4).
//   POST /api/v1/me/ask {question}  → 답변 파이프라인(llm/answer.ts). 예산은 Phase 5 — 지금은 개발용 하드 상한 ASK_DAILY_CAP(기본 20/일, budget_counter scope ask:dev).
//   GET  /api/v1/answers/{id}       → 이 설계사의 answer_log 한 행(화면 7 답변 재현). LLM을 부르지 않는다 —
//                                     툴은 저장된 인자로 다시 실행해(읽기 전용·결정론) 결과와 resultHash 일치 여부를, 검색 청크는 본문을 붙인다.
// 상한에 닿으면 LLM을 부르지 않고 429 + BUDGET 고정 문구 + retryAfterSeconds(다음 00:00 UTC까지 — §7 저하 모드 응답 모양, 거부도 answer_log에 남는다 — §4.4).
import type { Context } from "hono";
import { Hono } from "hono";
import { reserveBudget, rulebookChunks, type ScopedQuery } from "../db/ScopedQuery";
import { answerQuestion, cloudflareDeps, hash16, refuseWithoutLlm } from "../llm/answer";
import { groq, ProviderError, traced } from "../llm/providers";
import { type AppEnv, common, DISCLAIMER, invalidRequest, notFound, problem } from "./http";
import { InvalidToolCall, parseToolCall, runTool, serialize } from "../tools";
import { requireSession } from "./session";

export const ASK_DAILY_CAP_DEFAULT = 20;
const QUESTION_MAX = 500;
const ANSWER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function askDailyCap(env: { ASK_DAILY_CAP?: string }): number {
  const v = env.ASK_DAILY_CAP;
  if (v === undefined || v === "") return ASK_DAILY_CAP_DEFAULT;
  return /^(0|[1-9][0-9]{0,3})$/.test(v) ? Number(v) : ASK_DAILY_CAP_DEFAULT;
}

/** 답변 응답은 질문마다 다르다 — 캐시하지 않는다(no-store). 공통 필드·고정 문구는 읽기 API와 같다. */
function answerJson(c: Context<AppEnv>, body: object, status: 200 | 429 = 200): Response {
  return c.json({ ...common(c.get("scope")), ...body, disclaimer: DISCLAIMER }, status, { "Cache-Control": "no-store", Vary: "Cookie" });
}

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
  const day = now.toISOString().slice(0, 10);
  const deps = cloudflareDeps(c.env, traced(groq(c.env), c.env, c.env.DB));
  let r;
  if (!(await reserveBudget(c.env.DB, "ask:dev", day, askDailyCap(c.env)))) {
    r = await refuseWithoutLlm(deps, q, c.env, question, "BUDGET");
    return answerJson(c, { answerId: r.answerId, refused: true, reason: "BUDGET", text: r.text, retryAfterSeconds: secondsToUtcMidnight(now), promptVersion: r.promptVersion }, 429);
  } else {
    try {
      r = await answerQuestion(deps, q, c.env, question);
    } catch (e) {
      // Phase 4는 Groq만 — 공급자 실패(429·5xx·타임아웃)는 폴백 없이 503(폴백·저하 모드는 Phase 5)
      if (e instanceof ProviderError) {
        // 녹화 2026-11-04 A-02 503의 원인(429 TPM 추정)이 남지 않았다 — 상태·메시지만 남긴다(키·본문 없음)
        console.warn(`[ask] provider error ${e.status}: ${e.message}`);
        return problem(c, 503, "INTERNAL_ERROR");
      }
      throw e;
    }
  }
  return answerJson(c, {
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
    cacheHit: false,
    latencyMs: r.latencyMs,
    // 규정 검색 실패 시에만(임시 — 운영자 2026-11-03, 설계서 v0.1.22 §7): 규정 없이 툴만으로 답했다
    ...(r.rulesUnavailable ? { rulesUnavailable: true } : {}),
  });
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
