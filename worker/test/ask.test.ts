import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { secondsToUtcMidnight } from "../src/api/ask";
import { budgetCaps, userScope } from "../src/llm/budget";
import { hash16, REFUSAL_TEXT } from "../src/llm/answer";
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

  it("저하 ①: 전역 예산(min(BUDGET_GLOBAL, 공급자 합) — 배치 중 55+0+15 = 70)에 닿아도 429 BUDGET", async () => {
    const caps = budgetCaps(env);
    expect(caps.global).toBe(70);
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
