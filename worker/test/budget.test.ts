import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { anyProviderLeft, BUDGET_DEFAULTS, budgetCaps, budgetReport, countStat, reserveProvider, reserveQuestion, usageOn, userScope, withKeys } from "../src/llm/budget";

// PHASES Phase 5 항목 1·7 — 예산(설계서 v0.1.27 §6.2). 카운터는 D1(규약 5), 갱신은 UPDATE … WHERE used < ? 한 문장.
const DAY = "2026-11-06";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM budget_counter").run();
});

describe("상한(env)", () => {
  it("기본값 = PHASES 항목 1, 0~9999 정수만, 전역 = min(BUDGET_GLOBAL, 공급자 합)", () => {
    expect(budgetCaps({})).toEqual({ global: 150, user: 10, providers: { groq: 55, "workers-ai": 80, openrouter: 15 } });
    expect(BUDGET_DEFAULTS.global).toBe(150);
    // 설명 배치 중(v0.1.27): Workers AI 0 → 전역 55+0+15 = 70
    expect(budgetCaps({ BUDGET_WORKERS_AI: "0" }).global).toBe(70);
    expect(budgetCaps({ BUDGET_GLOBAL: "20" }).global).toBe(20);
    // 형식이 틀리면 기본값(무제한·음수가 되지 않게)
    expect(budgetCaps({ BUDGET_USER: "-1", BUDGET_GROQ: "abc", BUDGET_OPENROUTER: "99999" })).toMatchObject({ user: 10, providers: { groq: 55, openrouter: 15 } });
  });

  it("키 없는 공급자는 상한 0(시도·카운터를 쓰지 않는다), 전역도 다시 min", () => {
    const caps = budgetCaps({ BUDGET_WORKERS_AI: "0" });
    expect(withKeys(caps, { GROQ_API_KEY: "k" })).toMatchObject({ global: 55, providers: { groq: 55, "workers-ai": 0, openrouter: 0 } });
    expect(withKeys(caps, { GROQ_API_KEY: "k", OPENROUTER_API_KEY: "o" }).global).toBe(70);
    expect(withKeys(caps, {}).global).toBe(0);
  });

  it("배포 설정(wrangler.jsonc vars): 배치 중 Workers AI 0, 전역 70", () => {
    const caps = budgetCaps(env);
    expect(caps.providers["workers-ai"]).toBe(0);
    expect(caps.global).toBe(70);
  });
});

describe("사용자 키(ip 일일 솔트 해시)", () => {
  it("같은 날·같은 IP는 같은 키, 날이 바뀌거나 IP가 다르면 다른 키, 원문 IP는 키에 없다", async () => {
    const a = await userScope("s3cret", "203.0.113.7", DAY);
    expect(a).toMatch(/^ip:[0-9a-f]{16}$/);
    expect(a).not.toContain("203");
    expect(await userScope("s3cret", "203.0.113.7", DAY)).toBe(a);
    expect(await userScope("s3cret", "203.0.113.7", "2026-11-07")).not.toBe(a);
    expect(await userScope("s3cret", "203.0.113.8", DAY)).not.toBe(a);
    expect(await userScope("other", "203.0.113.7", DAY)).not.toBe(a);
    await expect(userScope(undefined, "203.0.113.7", DAY)).rejects.toThrow(/SESSION_SECRET/);
  });
});

describe("차감(D1 단일 UPDATE)", () => {
  const caps = { global: 3, user: 2, providers: { groq: 2, "workers-ai": 0, openrouter: 1 } };

  it("질문: 사용자 → 전역 순서, 사용자에 막히면 전역은 그대로", async () => {
    const u = "ip:aaaaaaaaaaaaaaaa";
    expect(await reserveQuestion(env.DB, caps, u, DAY)).toEqual({ ok: true });
    expect(await reserveQuestion(env.DB, caps, u, DAY)).toEqual({ ok: true });
    expect(await reserveQuestion(env.DB, caps, u, DAY)).toEqual({ ok: false, exhausted: "user" });
    expect((await usageOn(env.DB, caps, DAY)).global.used).toBe(2);
    expect(await reserveQuestion(env.DB, caps, "ip:bbbbbbbbbbbbbbbb", DAY)).toEqual({ ok: true });
    expect(await reserveQuestion(env.DB, caps, "ip:cccccccccccccccc", DAY)).toEqual({ ok: false, exhausted: "global" });
  });

  it("공급자: 상한 0이면 D1에 쓰지 않고 바로 소진, 남은 공급자 판정은 읽기만", async () => {
    expect(await reserveProvider(env.DB, caps, "workers-ai", DAY)).toBe(false);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM budget_counter WHERE scope = 'provider:workers-ai'").first("n")).toBe(0);
    expect(await reserveProvider(env.DB, caps, "openrouter", DAY)).toBe(true);
    expect(await reserveProvider(env.DB, caps, "openrouter", DAY)).toBe(false);
    expect(anyProviderLeft(await usageOn(env.DB, caps, DAY))).toBe(true); // groq 0/2
    await reserveProvider(env.DB, caps, "groq", DAY);
    await reserveProvider(env.DB, caps, "groq", DAY);
    expect(anyProviderLeft(await usageOn(env.DB, caps, DAY))).toBe(false);
  });

  it("동시 50요청(PHASES 항목 7): 상한 30이면 정확히 30만 통과, 카운터 30", async () => {
    const c = { ...caps, global: 30, user: 100 };
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => reserveQuestion(env.DB, c, `ip:${String(i).padStart(16, "0")}`, DAY)));
    expect(results.filter((r) => r.ok)).toHaveLength(30);
    expect(results.filter((r) => !r.ok && r.exhausted === "global")).toHaveLength(20);
    expect(await env.DB.prepare("SELECT used FROM budget_counter WHERE scope = 'global' AND day = ?").bind(DAY).first("used")).toBe(30);
  });
});

describe("GET /api/v1/budget(PHASES Phase 5 항목 6 — 공개)", () => {
  it("세션 없이 200·no-store, 오늘·7일·분포, 사용자 키(ip:…)는 내보내지 않는다", async () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const [scope, used] of [["global", 4], ["provider:groq", 5], ["ip:0123456789abcdef", 3], ["stat:depth:0", 3], ["stat:depth:1", 1], ["stat:refuse:budget", 2], ["stat:cache:miss", 4]] as const)
      await env.DB.prepare("INSERT INTO budget_counter (scope, day, used) VALUES (?, ?, ?)").bind(scope, today, used).run();
    const res = await exports.default.fetch(new Request("https://example.com/api/v1/budget"));
    expect([res.status, res.headers.get("Cache-Control")]).toEqual([200, "no-store"]);
    const text = await res.text();
    expect(text).not.toContain("ip:");
    const b = JSON.parse(text) as Awaited<ReturnType<typeof budgetReport>> & { caps: { global: number } };
    expect(b.days).toHaveLength(7);
    expect(b.days.at(-1)).toEqual({ day: today, questions: 4, providers: { groq: 5, "workers-ai": 0, openrouter: 0 } });
    expect(b.today.providers.groq.used).toBe(5);
    expect([b.fallbackDepth, b.refusals, b.cache]).toEqual([{ "0": 3, "1": 1, "2": 0 }, { BUDGET: 2 }, { hit: 0, miss: 4 }]);
  });

  it("7일 창: 오늘 포함 거슬러 7일, 그 밖의 날은 빠진다", async () => {
    await countStat(env.DB, "depth:2", "2026-10-30"); // 창 밖
    await countStat(env.DB, "depth:2", "2026-10-31");
    await countStat(env.DB, "depth:2", "2026-11-06");
    const r = await budgetReport(env.DB, budgetCaps({}), new Date("2026-11-06T12:00:00Z"));
    expect([r.days[0]!.day, r.days.at(-1)!.day, r.fallbackDepth["2"]]).toEqual(["2026-10-31", "2026-11-06", 2]);
  });
});
