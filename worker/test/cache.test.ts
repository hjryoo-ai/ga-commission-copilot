import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { rulebookChunks, ScopedQuery } from "../src/db/ScopedQuery";
import { type AnswerDeps, type AnswerOutput, answerCacheKey, answerQuestion, normalizeQuestion, REUSE_WINDOW_MS, reuseAnswer } from "../src/llm/answer";
import { budgetCaps, userScope } from "../src/llm/budget";
import { GATEWAY_CACHE_TTL_S, groq, openrouter, ProviderError, requestHash, type StructuredRequest, workersAi } from "../src/llm/providers";
import { HASH, login, seed } from "./fixture";

// PHASES Phase 5 항목 3 — AI Gateway·캐시(설계서 v0.1.29 §6.4). 게이트웨이·공급자는 가짜(LLM 호출 없음), D1은 로컬.
const q = (agentId = "A-1001") => new ScopedQuery(env.DB, { tenantId: "T1", agentId, stream: { streamHash: HASH, slot: "a" } });
const ENV = { PROMPT_VERSIONS: "answer=v1" };
const REQ: StructuredRequest = { model: "openai/gpt-oss-120b", messages: [{ role: "user", content: "q" }], schemaName: "answer", schema: { type: "object" }, maxCompletionTokens: 100, cacheKey: "ans:0123456789abcdef:1" };
const NOW = new Date("2026-11-06T03:00:00Z");

const okBody = (content: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ model: "m", choices: [{ message: { content } }], usage: null }), { status: 200, headers: { "content-type": "application/json", ...headers } });

/** 가짜 게이트웨이 — 받은 유니버설 요청을 남기고 정해 둔 응답을 낸다(Error면 던진다). */
function fakeGateway(reply: Response | Error) {
  const seen: { data: { provider: string; endpoint: string; headers: Record<string, unknown>; query: unknown }; opts: unknown }[] = [];
  return {
    seen,
    runner: () => ({
      run: (async (data: never, opts: unknown) => {
        seen.push({ data, opts });
        if (reply instanceof Error) throw reply;
        return reply;
      }) as never,
    }),
  };
}

const directFetch = () => {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(String(url));
    return okBody('{"direct":true}');
  }) as unknown as typeof fetch;
  return { f, calls };
};

describe("AI Gateway 경유(Groq·OpenRouter — 바인딩 gateway().run)", () => {
  it("유니버설 요청: provider·endpoint chat/completions·인증 헤더·캐시 키·TTL 24h, 본문은 직접 호출과 같다, 캐시 상태 헤더를 남긴다", async () => {
    const gw = fakeGateway(okBody('{"a":1}', { "cf-aig-cache-status": "HIT" }));
    const { f, calls } = directFetch();
    const r = await groq({ GROQ_API_KEY: "k" }, f, undefined, gw.runner).structured(REQ);
    expect([r.json, r.provider, r.gatewayCache, calls]).toEqual([{ a: 1 }, "groq", "HIT", []]);
    const { data } = gw.seen[0]!;
    expect([data.provider, data.endpoint]).toEqual(["groq", "chat/completions"]);
    expect(data.headers).toMatchObject({ authorization: "Bearer k", "content-type": "application/json", "cf-aig-cache-key": REQ.cacheKey, "cf-aig-cache-ttl": GATEWAY_CACHE_TTL_S });
    expect(data.query).toMatchObject({ model: REQ.model, temperature: 0, response_format: { type: "json_schema" } });
    expect(data.query).not.toHaveProperty("cacheKey");
    const o = fakeGateway(okBody('{"b":2}'));
    await openrouter({ OPENROUTER_API_KEY: "o" }, f, undefined, o.runner).structured(REQ);
    expect([o.seen[0]!.data.provider, (o.seen[0]!.data.query as { model: string }).model, o.seen[0]!.data.headers["x-title"]]).toEqual(["openrouter", "openrouter/free", "ga-commission-copilot"]);
  });

  it("공급자 429는 게이트웨이를 그대로 통과 — 직접 다시 부르지 않고 ProviderError 429(체인이 폴백)", async () => {
    const gw = fakeGateway(new Response(JSON.stringify({ error: { message: "rate limit", type: "tokens" } }), { status: 429, headers: { "retry-after": "9" } }));
    const { f, calls } = directFetch();
    await expect(groq({ GROQ_API_KEY: "k" }, f, undefined, gw.runner).structured(REQ)).rejects.toMatchObject({ status: 429, retryAfterS: 9 });
    expect(calls).toEqual([]);
  });

  it.each([
    ["게이트웨이 형식 오류 본문(401 code 2009)", new Response(JSON.stringify({ success: false, result: [], messages: [], error: [{ code: 2009, message: "Unauthorized" }] }), { status: 401 })],
    ["404(경로)", new Response("not found", { status: 404 })],
    ["바인딩이 던짐", new Error("AiGatewayInternalError")],
  ] as const)("게이트웨이 자체 오류 — %s → 직접 URL 1회", async (_label, reply) => {
    const gw = fakeGateway(reply);
    const { f, calls } = directFetch();
    const r = await groq({ GROQ_API_KEY: "k" }, f, undefined, gw.runner).structured(REQ);
    expect([r.json, calls, r.gatewayCache]).toEqual([{ direct: true }, ["https://api.groq.com/openai/v1/chat/completions"], undefined]);
  });

  it("게이트웨이 없으면(AI_GATEWAY_ID 없음) 직접 URL, 바인딩을 만들지 않는다", async () => {
    const { f, calls } = directFetch();
    await groq({ GROQ_API_KEY: "k" }, f).structured(REQ);
    expect(calls).toHaveLength(1);
  });

  it("카세트 키(requestHash)는 cacheKey와 무관", async () => {
    const { cacheKey: _drop, ...bare } = REQ;
    expect(await requestHash(REQ)).toBe(await requestHash(bare));
  });
});

describe("AI Gateway 경유(Workers AI — run(…, {gateway}))", () => {
  it("gateway {id, cacheKey, cacheTtl}를 넘기고, 게이트웨이 오류면 게이트웨이 없이 1회, 뉴런 소진은 그대로 429", async () => {
    const opts: unknown[] = [];
    const ai = (fail: Error | null) => ({
      run: (async (_m: string, _i: object, o?: { gateway?: unknown }) => {
        opts.push(o);
        if (fail && o?.gateway) throw fail;
        return { response: { ok: true } };
      }) as never,
    });
    expect((await workersAi(ai(null), "copilot").structured(REQ)).json).toEqual({ ok: true });
    expect(opts[0]).toEqual({ gateway: { id: "copilot", cacheTtl: GATEWAY_CACHE_TTL_S, cacheKey: REQ.cacheKey } });
    opts.length = 0;
    expect((await workersAi(ai(new Error("AiGateway: gateway not found")), "copilot").structured(REQ)).json).toEqual({ ok: true });
    expect(opts).toEqual([{ gateway: expect.objectContaining({ id: "copilot" }) }, undefined]);
    opts.length = 0;
    await expect(workersAi(ai(new Error("4006: you have used up your daily free allocation of 10,000 neurons")), "copilot").structured(REQ)).rejects.toMatchObject({ status: 429 });
    expect(opts).toHaveLength(1);
    await expect(workersAi(ai(new Error("4006 neurons")), "copilot").structured(REQ)).rejects.toBeInstanceOf(ProviderError);
  });
});

// --- 답변 파이프라인: 캐시 키·답 단위 재사용 ---

const CHUNK = { chunk_id: "rb-0123456789ab-a12-1", article: "제12조", title: "수수료 한도의 산정", body: "제12조(수수료 한도의 산정) — 가상 규정 · 예시값", visibility: "agent" };
const out = (o: Partial<AnswerOutput>): AnswerOutput => ({ refused: false, reason: null, text: "", numbersUsed: [], citations: [], toolCalls: [], ...o });
let seq = 0;

function deps(stage1: AnswerOutput, stage2?: AnswerOutput, now = NOW): AnswerDeps & { seen: StructuredRequest[] } {
  const seen: StructuredRequest[] = [];
  return {
    seen,
    provider: {
      name: "groq",
      async structured(req) {
        seen.push(req);
        return { json: req.messages[0]!.content.includes("단계: 2단계") ? stage2! : stage1, provider: "groq", model: "openai/gpt-oss-120b", usage: null };
      },
    },
    embed: async () => Array.from({ length: 1024 }, () => 0.01),
    search: async () => [{ id: CHUNK.chunk_id, score: 0.9 }],
    chunks: (ids) => rulebookChunks(env.DB, ids),
    now: () => now,
    newId: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
  };
}

beforeEach(async () => {
  await seed();
  for (const t of ["rulebook_chunk", "answer_log", "budget_counter"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
  await env.DB.prepare("INSERT INTO rulebook_chunk (chunk_id, article, title, body, visibility, version, token_count) VALUES (?, ?, ?, ?, ?, '0123456789ab', 50)")
    .bind(CHUNK.chunk_id, CHUNK.article, CHUNK.title, CHUNK.body, CHUNK.visibility)
    .run();
});

describe("게이트웨이 캐시 키(설계서 v0.1.29 §6.4)", () => {
  it("정규화 질문+agentId+streamHash+promptVersion의 해시 + 단계 — 2단계는 툴 결과 해시도 붙는다", async () => {
    const d = deps(out({ toolCalls: [{ tool: "get_statement", args: { ym: "202608", policyNo: null, from: null, to: null } as never }] }), out({ text: "설명입니다." }));
    await answerQuestion(d, q(), ENV, "8월 명세 설명해 줘?");
    const base = await answerCacheKey(normalizeQuestion("8월 명세 설명해 줘?"), "A-1001", HASH, "answer/v1");
    expect(base).toMatch(/^ans:[0-9a-f]{16}$/);
    expect(d.seen.map((r) => r.cacheKey)).toEqual([`${base}:1`, expect.stringMatching(new RegExp(`^${base}:2:[0-9a-f]{16}$`))]);
    // 문장부호만 다른 질문은 같은 키, 다른 설계사·다른 프롬프트는 다른 키
    expect(await answerCacheKey(normalizeQuestion("8월 명세 설명해 줘"), "A-1001", HASH, "answer/v1")).toBe(base);
    expect(await answerCacheKey(normalizeQuestion("8월 명세 설명해 줘"), "A-1002", HASH, "answer/v1")).not.toBe(base);
    expect(await answerCacheKey(normalizeQuestion("8월 명세 설명해 줘"), "A-1001", HASH, "answer/v3")).not.toBe(base);
  });
});

describe("답 단위 재사용(설계서 v0.1.29 — 캐시 히트는 예산 미차감)", () => {
  it("24시간 안 같은 키의 PASS를 그대로, answer_log에 cache_hit=1 새 행 — 창 밖·다른 설계사·다른 프롬프트는 없음", async () => {
    const first = await answerQuestion(deps(out({ text: "이 달 명세는 기본 수수료만 있습니다." })), q(), ENV, "8월 명세 설명해 줘?");
    expect(first.groundingStatus).toBe("PASS");
    const later = new Date(NOW.getTime() + 3600_000);
    const r = await reuseAnswer(deps(out({}), undefined, later), q(), ENV, "8월 명세 설명해 줘");
    expect(r).toMatchObject({ refused: false, text: first.text, groundingStatus: "PASS", provider: "groq", promptVersion: "answer/v1", citations: first.citations, retrievedChunks: first.retrievedChunks });
    expect(r!.answerId).not.toBe(first.answerId);
    const row = await env.DB.prepare("SELECT cache_hit, agent_id, answer, created_at FROM answer_log WHERE answer_id = ?").bind(r!.answerId).first();
    expect(row).toEqual({ cache_hit: 1, agent_id: "A-1001", answer: first.text, created_at: later.toISOString() });
    // 창은 원래 답(cache_hit 0)에서 24시간 — 재사용 행이 창을 늘리지 않는다
    expect(await reuseAnswer(deps(out({}), undefined, new Date(NOW.getTime() + REUSE_WINDOW_MS + 1)), q(), ENV, "8월 명세 설명해 줘")).toBeNull();
    expect(await reuseAnswer(deps(out({}), undefined, later), q("A-1002"), ENV, "8월 명세 설명해 줘")).toBeNull();
    expect(await reuseAnswer(deps(out({}), undefined, later), q(), { PROMPT_VERSIONS: "answer=v3" }, "8월 명세 설명해 줘")).toBeNull();
  });

  it("모델 거부(범위 밖)는 재사용, 근거 실패(FAIL)·규정 없이 답한 행(저하 ③)은 재사용하지 않는다", async () => {
    await answerQuestion(deps(out({ refused: true, reason: "OUT_OF_SCOPE" })), q(), ENV, "오늘 날씨는?");
    expect(await reuseAnswer(deps(out({})), q(), ENV, "오늘 날씨는")).toMatchObject({ refused: true, reason: "OUT_OF_SCOPE" });
    await answerQuestion(deps(out({ text: "8월은 999,999원입니다.", numbersUsed: ["999,999원"] })), q(), ENV, "8월 합계?");
    expect(await reuseAnswer(deps(out({})), q(), ENV, "8월 합계")).toBeNull();
    const noRules = { ...deps(out({ text: "설명입니다." })), search: async () => Promise.reject(new Error("4006")) };
    expect((await answerQuestion(noRules, q(), ENV, "규정 없이")).rulesUnavailable).toBe(true);
    expect(await reuseAnswer(deps(out({})), q(), ENV, "규정 없이")).toBeNull();
  });

  it("조회는 ix_ans_created 범위 검색(풀스캔 아님 — 설계서 §5.3)", async () => {
    const plan = await env.DB.prepare(
      "EXPLAIN QUERY PLAN SELECT * FROM answer_log WHERE created_at >= ? AND tenant_id = ? AND agent_id = ? AND stream_hash = ? AND prompt_version = ? AND normalized_question = ? AND cache_hit = 0 AND retrieved_chunks <> '[]' AND (grounding_status = 'PASS' OR (refused = 1 AND refuse_reason IN ('OUT_OF_SCOPE', 'OTHER_AGENT', 'NEEDS_ENGINE'))) ORDER BY created_at DESC LIMIT 1",
    )
      .bind("2026-11-05T00:00:00Z", "T1", "A-1001", HASH, "answer/v1", "x")
      .all<{ detail: string }>();
    expect(plan.results.map((r) => r.detail).join(" | ")).toMatch(/USING INDEX ix_ans_created/);
  });

  it("POST /ask: 예산이 소진돼도 재사용 답은 200 cacheHit, 예산 차감 없음, stat:cache:hit 1", async () => {
    const app = exports.default;
    const today = new Date().toISOString().slice(0, 10);
    await answerQuestion({ ...deps(out({ text: "이 달 명세는 기본 수수료만 있습니다." })), now: () => new Date() }, q(), { PROMPT_VERSIONS: "answer=v3" }, "8월 명세 설명해 줘");
    await env.DB.prepare("INSERT INTO budget_counter (scope, day, used) VALUES (?, ?, ?)").bind(await userScope(env.SESSION_SECRET, "local", today), today, budgetCaps(env).user).run();
    const res = await app.fetch(
      new Request("https://example.com/api/v1/me/ask", { method: "POST", headers: { "Content-Type": "application/json", Cookie: await login(app, 1) }, body: JSON.stringify({ question: "8월 명세 설명해 줘?" }) }),
    );
    expect(res.status).toBe(200);
    // 재사용은 예산을 쓰지 않으므로 응답 budget은 그대로(사용자 0 — 채워 둔 값, 전역 35 — v0.1.33)
    expect(await res.json()).toMatchObject({ cacheHit: true, refused: false, text: "이 달 명세는 기본 수수료만 있습니다.", promptVersion: "answer/v3", groundingStatus: "PASS", budget: { remainingToday: 35, userRemaining: 0 } });
    const counters = (await env.DB.prepare("SELECT scope, used FROM budget_counter WHERE scope NOT LIKE 'rl:%' ORDER BY scope").all<{ scope: string; used: number }>()).results;
    expect(counters).toEqual([
      { scope: await userScope(env.SESSION_SECRET, "local", today), used: budgetCaps(env).user },
      { scope: "stat:cache:hit", used: 1 },
    ]);
  });
});
