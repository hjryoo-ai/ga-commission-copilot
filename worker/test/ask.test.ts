import { createExecutionContext, env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { secondsToUtcMidnight } from "../src/api/ask";
import worker from "../src/index";
import { budgetCaps, rateScope, userScope } from "../src/llm/budget";
import { hash16, REFUSAL_TEXT } from "../src/llm/answer";
import { validate } from "./contract";
import { HASH, login, seed } from "./fixture";

// PHASES Phase 4 항목 4·Phase 5 항목 1·4 — POST /api/v1/me/ask·GET /api/v1/answers/{id}. LLM을 부르지 않는 경로만(입력 검사·예산 저하 ①·재현 소유 확인).
// LLM 경로는 test/answer.test.ts(가짜 공급자). answer_log는 로컬 D1(운영자 2026-11-01).
const app = exports.default;
const today = () => new Date().toISOString().slice(0, 10);

async function ask(cookie: string | null, body: unknown): Promise<Response> {
  return app.fetch(
    new Request("https://example.com/api/v1/me/ask", { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) }),
  );
}

beforeEach(async () => {
  await seed();
  for (const t of ["answer_log", "budget_counter"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe("POST /api/v1/me/ask", () => {
  afterEach(() => vi.restoreAllMocks());

  it("응답 budget(설계서 v0.1.33): 답 1건 뒤 남은 질문이 1 준다(200 — 가짜 Groq), 429 BUDGET 뒤 값은 응답과 /me가 같다", async () => {
    const one = await login(app, 1);
    const me = async () => ((await (await app.fetch(new Request("https://example.com/api/v1/me", { headers: { Cookie: one } }))).json()) as { budget: { remainingToday: number; userRemaining: number } }).budget;
    const before = await me();
    expect(before).toMatchObject({ remainingToday: 35, userRemaining: 10 });
    // 가짜 Groq(외부 호출 없음): 1단계에서 범위 밖 거부 — 답 1건, 호출 1회. 질문 임베딩은 시험 환경에서 원격 바인딩이 없어 실패 → 저하 ③(규정 없이)
    const groqReply = { model: "openai/gpt-oss-120b", choices: [{ message: { content: JSON.stringify({ refused: true, reason: "OUT_OF_SCOPE", text: "", numbersUsed: [], citations: [], toolCalls: [] }) } }], usage: null };
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("https://api.groq.com/")) throw new Error(`예상 밖 외부 호출 ${url}`);
      return new Response(JSON.stringify(groqReply), { status: 200, headers: { "content-type": "application/json" } });
    });
    // AI 바인딩도 가짜(원격 바인딩 없는 시험에서 진짜를 건드리면 miniflare가 uncaught를 찍는다): 임베딩 실패 → 저하 ③, 게이트웨이 실패 → 직접 1회(가짜 fetch)
    const fakeAi = { run: async () => Promise.reject(new Error("4006: neurons (test)")), gateway: () => ({ run: async () => Promise.reject(new Error("AiGateway (test)")) }) };
    const res = await worker.fetch(
      new Request("https://example.com/api/v1/me/ask", { method: "POST", headers: { "Content-Type": "application/json", Cookie: one }, body: JSON.stringify({ question: "오늘 날씨는 어때요?" }) }),
      { ...env, AI: fakeAi } as unknown as Env,
      createExecutionContext(),
    );
    expect(res.status).toBe(200);
    const b = (await res.json()) as { budget: unknown; reason: string; cacheHit: boolean };
    expect([b.reason, b.cacheHit]).toEqual(["OUT_OF_SCOPE", false]);
    expect(b.budget).toEqual({ remainingToday: before.remainingToday - 1, userRemaining: before.userRemaining - 1 });
    expect(validate("AskResponse", b)).toEqual([]);
    expect(spy).toHaveBeenCalled();
    vi.restoreAllMocks();
    // 응답 값 = 그 뒤 /me 값(칩이 /me를 다시 부르지 않아도 맞다)
    expect(await me()).toMatchObject(b.budget as object);
    // 사용자 예산을 채운 뒤 429 BUDGET — 응답 budget의 userRemaining 0, /me와 같다
    await env.DB.prepare("UPDATE budget_counter SET used = ? WHERE scope = ?").bind(budgetCaps(env).user, await userScope(env.SESSION_SECRET, "local", today())).run();
    const r429 = await ask(one, { question: "8월 실수령은 얼마예요?" });
    const b429 = (await r429.json()) as { budget: { remainingToday: number; userRemaining: number } };
    expect([r429.status, b429.budget.userRemaining]).toEqual([429, 0]);
    expect(validate("AskResponse", b429)).toEqual([]);
    expect(await me()).toMatchObject(b429.budget);
  });

  it("세션 없으면 401, 질문이 비거나 500자 넘거나 다른 키가 있으면 400", async () => {
    expect((await ask(null, { question: "8월 실수령은?" })).status).toBe(401);
    const one = await login(app, 1);
    for (const body of [{}, { question: "  " }, { question: "가".repeat(501) }, { question: "8월?", agentId: "A-1009" }, { question: 3 }]) expect((await ask(one, body)).status, JSON.stringify(body)).toBe(400);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM answer_log").first("n")).toBe(0);
  });

  it("저하 ①(설계서 v0.1.27): 사용자 예산(ip 솔트 해시)에 닿으면 LLM 없이 BUDGET 고정 문구, answer_log에 거부로 남는다", async () => {
    const caps = budgetCaps(env);
    const user = await userScope(env.SESSION_SECRET, "local", today());
    await env.DB.prepare("INSERT INTO budget_counter (scope, day, used) VALUES (?, ?, ?)").bind(user, today(), caps.user).run();
    const res = await ask(await login(app, 1), { question: "8월 실수령은 얼마예요?" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const b = (await res.json()) as Record<string, unknown>;
    expect(b).toMatchObject({ refused: true, reason: "BUDGET", text: REFUSAL_TEXT.BUDGET, promptVersion: "answer/v3", asOf: { streamHash: HASH, demoNo: 1 }, disclaimer: expect.any(String) });
    expect(b.retryAfterSeconds as number).toBeGreaterThan(0);
    expect(b.retryAfterSeconds as number).toBeLessThanOrEqual(86_400);
    const row = await env.DB.prepare("SELECT agent_id, provider, refused, refuse_reason, grounding_status, stream_hash FROM answer_log WHERE answer_id = ?").bind(b.answerId).first();
    expect(row).toEqual({ agent_id: "A-1001", provider: "none", refused: 1, refuse_reason: "BUDGET", grounding_status: "NONE", stream_hash: HASH });
    expect(await env.DB.prepare("SELECT violations FROM answer_log WHERE answer_id = ?").bind(b.answerId).first("violations")).toBe('{"g1Shape":[],"g4Missing":[],"g5Unknown":[],"g6Words":[]}');
    // 상한은 그대로(차감 실패 — UPDATE … WHERE used < ? 영향 행 0), 전역은 건드리지 않는다(사용자 먼저)
    expect(await env.DB.prepare("SELECT used FROM budget_counter WHERE scope = ?").bind(user).first("used")).toBe(caps.user);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM budget_counter WHERE scope = 'global' AND used > 0").first("n")).toBe(0);
  });

  it("레이트 리밋(설계서 v0.1.29 §7): 이 IP의 이번 분이 3이면 429 RATE_LIMITED + Retry-After, answer_log·예산은 그대로", async () => {
    const user = await userScope(env.SESSION_SECRET, "local", today());
    const now = Date.now();
    // 분 경계를 넘어도 같은 판정이 되게 이번 분·다음 분 둘 다 3
    for (const t of [now, now + 60_000]) await env.DB.prepare("INSERT OR REPLACE INTO budget_counter (scope, day, used) VALUES (?, ?, 3)").bind(rateScope(user, new Date(t)), new Date(t).toISOString().slice(0, 10)).run();
    const res = await ask(await login(app, 1), { question: "8월 실수령은 얼마예요?" });
    expect([res.status, res.headers.get("Content-Type"), res.headers.get("Cache-Control")]).toEqual([429, "application/problem+json", "no-store"]);
    const retry = Number(res.headers.get("Retry-After"));
    expect(retry >= 1 && retry <= 60).toBe(true);
    // 남은 질문(v0.1.33): 레이트 리밋은 예산을 쓰지 않으므로 그대로 — 전역 35(배치 중), 사용자 10
    const body = await res.json();
    expect(body).toEqual({ code: "RATE_LIMITED", message: "질문이 잦습니다 — 1분 뒤 다시 시도하세요", budget: { remainingToday: 35, userRemaining: 10 } });
    expect(validate("Problem", body)).toEqual([]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM answer_log").first("n")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM budget_counter WHERE scope NOT LIKE 'rl:%'").first("n")).toBe(0);
  });

  it("저하 ①: 전역 예산(min(BUDGET_GLOBAL, floor(공급자 호출 합 ÷ 2)) — 배치 중 floor(70/2) = 35)에 닿아도 429 BUDGET", async () => {
    const caps = budgetCaps(env);
    expect(caps.global).toBe(35);
    await env.DB.prepare("INSERT INTO budget_counter (scope, day, used) VALUES ('global', ?, ?)").bind(today(), caps.global).run();
    const res = await ask(await login(app, 1), { question: "8월 실수령은 얼마예요?" });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { reason: string }).reason).toBe("BUDGET");
  });

  it("저하 ①: 시도할 공급자가 모두 오늘 상한이면(Groq·OpenRouter 소진, Workers AI 0) LLM 없이 429 BUDGET — 공급자 카운터는 그대로", async () => {
    const caps = budgetCaps(env);
    for (const [p, cap] of [["groq", caps.providers.groq], ["openrouter", caps.providers.openrouter]] as const)
      await env.DB.prepare("INSERT INTO budget_counter (scope, day, used) VALUES (?, ?, ?)").bind(`provider:${p}`, today(), cap).run();
    const res = await ask(await login(app, 1), { question: "8월 실수령은 얼마예요?" });
    expect(res.status).toBe(429);
    const b = (await res.json()) as { reason: string; answerId: string };
    expect(b.reason).toBe("BUDGET");
    expect(await env.DB.prepare("SELECT refuse_reason FROM answer_log WHERE answer_id = ?").bind(b.answerId).first("refuse_reason")).toBe("BUDGET");
    expect(await env.DB.prepare("SELECT used FROM budget_counter WHERE scope = 'provider:groq'").first("used")).toBe(caps.providers.groq);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM budget_counter WHERE scope = 'provider:workers-ai'").first("n")).toBe(0);
    // 공개 /budget 분포(설계서 v0.1.28)
    expect(await env.DB.prepare("SELECT used FROM budget_counter WHERE scope = 'stat:refuse:budget'").first("used")).toBe(1);
  });

  it("PHASES Phase 5 항목 7: 소진 뒤에도 설명·명세 API는 200(저하 모드는 자유 질문만), /me 남은 질문 0·DEGRADED", async () => {
    await env.DB.prepare("INSERT INTO budget_counter (scope, day, used) VALUES ('global', ?, ?)").bind(today(), budgetCaps(env).global).run();
    const one = await login(app, 1);
    expect((await ask(one, { question: "8월 실수령은?" })).status).toBe(429);
    const get = (path: string) => app.fetch(new Request(`https://example.com${path}`, { headers: { Cookie: one } }));
    for (const path of ["/api/v1/me/earnings/lines/1", "/api/v1/me/limits", "/api/v1/me/earnings/202608/diff"]) expect((await get(path)).status, path).toBe(200);
    const me = (await (await get("/api/v1/me")).json()) as { budget: { remainingToday: number }; dataStatus: string };
    expect([me.budget.remainingToday, me.dataStatus]).toEqual([0, "DEGRADED"]);
  });

  it("retryAfterSeconds = 다음 00:00 UTC까지", () => {
    expect(secondsToUtcMidnight(new Date("2026-11-01T23:59:00Z"))).toBe(60);
    expect(secondsToUtcMidnight(new Date("2026-11-01T00:00:00Z"))).toBe(86_400);
  });


});

describe("GET /api/v1/answers/{id}", () => {
  it("자기 답변만 재현, 남의 답변·형식 틀린 id는 404", async () => {
    await env.DB.prepare("INSERT INTO budget_counter (scope, day, used) VALUES (?, ?, ?)").bind(await userScope(env.SESSION_SECRET, "local", today()), today(), budgetCaps(env).user).run();
    const one = await login(app, 1);
    const { answerId } = (await (await ask(one, { question: "8월 실수령은?" })).json()) as { answerId: string };
    const get = (cookie: string, id: string) => app.fetch(new Request(`https://example.com/api/v1/answers/${id}`, { headers: { Cookie: cookie } }));
    const mine = await get(one, answerId);
    expect(mine.status).toBe(200);
    expect(await mine.json()).toMatchObject({ answerId, question: "8월 실수령은?", answer: REFUSAL_TEXT.BUDGET, refused: true, reason: "BUDGET", retrievedChunks: [], toolCalls: [], fallbackDepth: 0, violations: { g4Missing: [], g5Unknown: [], g6Words: [] } });
    expect((await get(await login(app, 2), answerId)).status).toBe(404);
    expect((await get(one, "not-a-uuid")).status).toBe(404);
  });
  it("재현(LLM 없음): 정규화 질문, 툴은 저장된 인자로 다시 실행해 결과·resultHash 일치, 청크는 agent 본문만", async () => {
    for (const [id, article, vis] of [["rb-07", "제7조", "agent"], ["rb-39", "제39조", "internal"]] as const) {
      await env.DB.prepare("INSERT OR REPLACE INTO rulebook_chunk (chunk_id, article, title, body, visibility, version, token_count) VALUES (?, ?, '한도', ?, ?, '0123456789ab', 50)")
        .bind(id, article, `${article} 가상 규정 · 예시값 본문`, vis)
        .run();
    }
    const put = async (answerId: string, toolCalls: unknown) =>
      env.DB.prepare(
        "INSERT INTO answer_log (answer_id, tenant_id, agent_id, question, normalized_question, stream_hash, prompt_version, provider, model, fallback_depth, retrieved_chunks, tool_calls, answer, numbers_used, citations, refused, refuse_reason, grounding_status, latency_ms, cache_hit, created_at) VALUES (?, 'T1', 'A-1001', '8월 시책이 왜?', '8월 시책이 왜', ?, 'answer/v3', 'groq', 'openai/gpt-oss-120b', 0, ?, ?, '답', '[]', '[]', 0, NULL, 'PASS', 1234, 0, '2026-11-05T00:00:00Z')",
      )
        .bind(answerId, HASH, JSON.stringify([["rb-07", 0.71], ["rb-39", 0.5]]), JSON.stringify(toolCalls))
        .run();
    const one = await login(app, 1);
    const get = async (id: string) => (await (await app.fetch(new Request(`https://example.com/api/v1/answers/${id}`, { headers: { Cookie: one } }))).json()) as Record<string, any>;
    const A = "00000000-0000-4000-8000-00000000000a";
    const B = "00000000-0000-4000-8000-00000000000b";
    await put(A, [{ tool: "get_statement", args: { ym: "202608" }, resultHash: "0000000000000000" }, { tool: "get_limit", args: { policyNo: "!!" }, resultHash: "x" }]);
    const a = await get(A);
    expect(a.normalizedQuestion).toBe("8월 시책이 왜");
    expect(a.violations).toBeNull(); // 0006 이전 행(violations NULL)
    expect(a.toolCalls[0]).toMatchObject({ tool: "get_statement", args: { ym: "202608" }, reproduced: false, truncated: false });
    expect(a.toolCalls[0].result).toBeTruthy();
    expect(a.toolCalls[1]).toEqual({ tool: "get_limit", args: { policyNo: "!!" }, resultHash: "x", reproduced: false });
    expect(a.retrievedChunks).toEqual([
      { chunkId: "rb-07", score: 0.71, article: "제7조", title: "한도", body: "제7조 가상 규정 · 예시값 본문", version: "0123456789ab" },
      { chunkId: "rb-39", score: 0.5 },
    ]);
    // 답변 때와 같은 결과면 reproduced true(해시는 파이프라인과 같은 hash16(serialize))
    await put(B, [{ tool: "get_statement", args: { ym: "202608" }, resultHash: await hash16(JSON.stringify(a.toolCalls[0].result)) }]);
    expect((await get(B)).toolCalls[0].reproduced).toBe(true);
  });
});
