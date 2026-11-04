import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ASK_DAILY_CAP_DEFAULT, askDailyCap, secondsToUtcMidnight } from "../src/api/ask";
import { REFUSAL_TEXT } from "../src/llm/answer";
import { HASH, login, seed } from "./fixture";

// PHASES Phase 4 항목 4 — POST /api/v1/me/ask·GET /api/v1/answers/{id}. LLM을 부르지 않는 경로만(입력 검사·개발 상한·재현 소유 확인).
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

  it("개발 하드 상한(budget_counter ask:dev)에 닿으면 LLM 없이 BUDGET 고정 문구, answer_log에 거부로 남는다", async () => {
    await env.DB.prepare("INSERT INTO budget_counter (scope, day, used) VALUES ('ask:dev', ?, ?)").bind(today(), ASK_DAILY_CAP_DEFAULT).run();
    const res = await ask(await login(app, 1), { question: "8월 실수령은 얼마예요?" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const b = (await res.json()) as Record<string, unknown>;
    expect(b).toMatchObject({ refused: true, reason: "BUDGET", text: REFUSAL_TEXT.BUDGET, promptVersion: "answer/v3", asOf: { streamHash: HASH, demoNo: 1 }, disclaimer: expect.any(String) });
    expect(b.retryAfterSeconds as number).toBeGreaterThan(0);
    expect(b.retryAfterSeconds as number).toBeLessThanOrEqual(86_400);
    const row = await env.DB.prepare("SELECT agent_id, provider, refused, refuse_reason, grounding_status, stream_hash FROM answer_log WHERE answer_id = ?").bind(b.answerId).first();
    expect(row).toEqual({ agent_id: "A-1001", provider: "none", refused: 1, refuse_reason: "BUDGET", grounding_status: "NONE", stream_hash: HASH });
    // 상한은 그대로(차감 실패 — UPDATE … WHERE used < ? 영향 행 0)
    expect(await env.DB.prepare("SELECT used FROM budget_counter WHERE scope = 'ask:dev'").first("used")).toBe(ASK_DAILY_CAP_DEFAULT);
  });

  it("retryAfterSeconds = 다음 00:00 UTC까지", () => {
    expect(secondsToUtcMidnight(new Date("2026-11-01T23:59:00Z"))).toBe(60);
    expect(secondsToUtcMidnight(new Date("2026-11-01T00:00:00Z"))).toBe(86_400);
  });

  it("ASK_DAILY_CAP: 기본 20, 0~9999 정수만, 형식이 틀리면 기본", () => {
    expect([askDailyCap({}), askDailyCap({ ASK_DAILY_CAP: "5" }), askDailyCap({ ASK_DAILY_CAP: "0" }), askDailyCap({ ASK_DAILY_CAP: "-1" }), askDailyCap({ ASK_DAILY_CAP: "abc" })]).toEqual([20, 5, 0, 20, 20]);
  });
});

describe("GET /api/v1/answers/{id}", () => {
  it("자기 답변만 재현, 남의 답변·형식 틀린 id는 404", async () => {
    await env.DB.prepare("INSERT INTO budget_counter (scope, day, used) VALUES ('ask:dev', ?, ?)").bind(today(), ASK_DAILY_CAP_DEFAULT).run();
    const one = await login(app, 1);
    const { answerId } = (await (await ask(one, { question: "8월 실수령은?" })).json()) as { answerId: string };
    const get = (cookie: string, id: string) => app.fetch(new Request(`https://example.com/api/v1/answers/${id}`, { headers: { Cookie: cookie } }));
    const mine = await get(one, answerId);
    expect(mine.status).toBe(200);
    expect(await mine.json()).toMatchObject({ answerId, question: "8월 실수령은?", answer: REFUSAL_TEXT.BUDGET, refused: true, reason: "BUDGET", retrievedChunks: [], toolCalls: [], fallbackDepth: 0 });
    expect((await get(await login(app, 2), answerId)).status).toBe(404);
    expect((await get(one, "not-a-uuid")).status).toBe(404);
  });
});
