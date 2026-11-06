import { createExecutionContext, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HUMAN_MAX_AGE_S, SITEVERIFY_URL, siteverify } from "../src/api/turnstile";
import worker from "../src/index";
import { budgetCaps, userScope } from "../src/llm/budget";
import { validate } from "./contract";
import { login, seed } from "./fixture";

// PHASES Phase 5 항목 5 — Turnstile(설계서 v0.1.29 §9). Siteverify는 가짜 fetch(외부 호출 없음).
const SECRET = "test-turnstile-secret";
const withSecret = { ...env, TURNSTILE_SECRET: SECRET } as Env;
const fetchWith = (e: Env, path: string, init: RequestInit & { cookie?: string } = {}) =>
  worker.fetch(new Request(`https://example.com${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init.cookie ? { Cookie: init.cookie } : {}), ...(init.headers ?? {}) } }), e, createExecutionContext());
const ask = (e: Env, cookie: string) => fetchWith(e, "/api/v1/me/ask", { method: "POST", cookie, body: JSON.stringify({ question: "8월 실수령은 얼마예요?" }) });
const verify = (cookie: string) => fetchWith(withSecret, "/api/v1/me/turnstile", { method: "POST", cookie, body: JSON.stringify({ token: "tok-123" }) });

const verifyReply = (b: object, status = 200) => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } }));
const humanCookie = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith("copilot_human="))!;

let session: string;
beforeEach(async () => {
  await seed();
  for (const t of ["answer_log", "budget_counter"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
  session = await login({ fetch: (r: Request) => worker.fetch(r, env, createExecutionContext()) } as never, 1);
});
afterEach(() => vi.restoreAllMocks());

describe("Siteverify(공식 문서 — POST form secret·response·remoteip)", () => {
  it("form 필드와 응답 해석(success·hostname·error-codes), 200이 아니면 던진다", async () => {
    let sent: FormData | null = null;
    const r = await siteverify(SECRET, "tok", "203.0.113.7", (async (url: string, init: RequestInit) => {
      expect(url).toBe(SITEVERIFY_URL);
      sent = init.body as FormData;
      return new Response(JSON.stringify({ success: false, "error-codes": ["timeout-or-duplicate"] }));
    }) as never);
    expect([sent!.get("secret"), sent!.get("response"), sent!.get("remoteip")]).toEqual([SECRET, "tok", "203.0.113.7"]);
    expect(r).toEqual({ success: false, errorCodes: ["timeout-or-duplicate"] });
    await expect(siteverify(SECRET, "tok", null, (async () => new Response("", { status: 500 })) as never)).rejects.toThrow(/500/);
  });
});

describe("TURNSTILE_SECRET 없는 환경(로컬·시험)", () => {
  it("/me turnstile {required: false, verified: true}, /ask는 검사하지 않는다", async () => {
    const me = (await (await fetchWith(env, "/api/v1/me", { cookie: session })).json()) as { turnstile: unknown };
    expect(me.turnstile).toEqual({ required: false, verified: true });
    // LLM·임베딩을 부르지 않게 사용자 예산을 채워 둔다 — 게이트를 지나면 429 BUDGET
    const today = new Date().toISOString().slice(0, 10);
    await env.DB.prepare("INSERT INTO budget_counter (scope, day, used) VALUES (?, ?, ?)").bind(await userScope(env.SESSION_SECRET, "local", today), today, budgetCaps(env).user).run();
    expect((await ask(env, session)).status).toBe(429);
  });
});

describe("TURNSTILE_SECRET 있는 환경", () => {
  it("쿠키 없으면 /ask 403 TURNSTILE_REQUIRED — answer_log·예산·레이트 리밋 카운터 0, /me는 siteKey와 verified false", async () => {
    const res = await ask(withSecret, session);
    expect([res.status, res.headers.get("Content-Type")]).toEqual([403, "application/problem+json"]);
    expect(await res.json()).toEqual({ code: "TURNSTILE_REQUIRED", message: "사람 확인을 먼저 마치세요" });
    expect(await env.DB.prepare("SELECT (SELECT COUNT(*) FROM answer_log) + (SELECT COUNT(*) FROM budget_counter) AS n").first("n")).toBe(0);
    const me = (await (await fetchWith(withSecret, "/api/v1/me", { cookie: session })).json()) as { turnstile: unknown };
    expect(me.turnstile).toEqual({ required: true, verified: false, siteKey: "0x4AAAAAAF2LyuLvbqeCCVE5" });
    expect(validate("MeResponse", me)).toEqual([]);
  });

  it("Siteverify 성공 → 24시간 서명 쿠키(HttpOnly·Secure·SameSite=Lax) → /ask가 게이트를 지난다, /me verified true", async () => {
    const spy = verifyReply({ success: true, hostname: "example.com" });
    const res = await verify(session);
    expect([res.status, res.headers.get("Cache-Control")]).toEqual([200, "no-store"]);
    expect(await res.json()).toMatchObject({ verified: true, required: true, expiresAt: expect.any(String) });
    expect(spy).toHaveBeenCalledTimes(1);
    const set = humanCookie(res);
    expect(set).toMatch(new RegExp(`Max-Age=${HUMAN_MAX_AGE_S}`));
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/Secure/);
    expect(set).toMatch(/SameSite=Lax/);
    const both = `${session}; ${set.split(";")[0]}`;
    vi.restoreAllMocks();
    // 게이트를 지났는지는 LLM 없이 본다 — 사용자 예산을 채워 두면 429 BUDGET(403이 아니다)
    const today = new Date().toISOString().slice(0, 10);
    await env.DB.prepare("INSERT INTO budget_counter (scope, day, used) VALUES (?, ?, ?)").bind(await userScope(env.SESSION_SECRET, "local", today), today, budgetCaps(env).user).run();
    const a = await ask(withSecret, both);
    expect([a.status, ((await a.json()) as { reason: string }).reason]).toEqual([429, "BUDGET"]);
    const me = (await (await fetchWith(withSecret, "/api/v1/me", { cookie: both })).json()) as { turnstile: { verified: boolean } };
    expect(me.turnstile.verified).toBe(true);
  });

  it.each([
    ["success false", { success: false, "error-codes": ["invalid-input-response"] }, 403],
    ["다른 호스트 토큰", { success: true, hostname: "evil.example" }, 403],
  ] as const)("Siteverify %s → %i, 쿠키 없음", async (_l, reply, status) => {
    verifyReply(reply);
    const res = await verify(session);
    expect(res.status).toBe(status);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("copilot_human="))).toBe(false);
  });

  it("Siteverify 네트워크 오류 → 503, 토큰 형식(없음·2048자 초과·다른 키) → 400, 세션 없으면 401", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network"));
    expect((await verify(session)).status).toBe(503);
    for (const body of [{}, { token: "" }, { token: "x".repeat(2049) }, { token: "t", extra: 1 }])
      expect((await fetchWith(withSecret, "/api/v1/me/turnstile", { method: "POST", cookie: session, body: JSON.stringify(body) })).status).toBe(400);
    expect((await fetchWith(withSecret, "/api/v1/me/turnstile", { method: "POST", body: JSON.stringify({ token: "t" }) })).status).toBe(401);
  });

  it("쿠키는 확인한 IP에서만 — 같은 쿠키를 다른 IP에서 보내면 403(한 번 푼 쿠키를 봇 여러 대가 나눠 쓰지 못하게)", async () => {
    verifyReply({ success: true });
    const fromA = { "CF-Connecting-IP": "203.0.113.7" };
    const res = await fetchWith(withSecret, "/api/v1/me/turnstile", { method: "POST", cookie: session, headers: fromA, body: JSON.stringify({ token: "tok" }) });
    const both = `${session}; ${humanCookie(res).split(";")[0]}`;
    vi.restoreAllMocks();
    const me = async (ip: string) => ((await (await fetchWith(withSecret, "/api/v1/me", { cookie: both, headers: { "CF-Connecting-IP": ip } })).json()) as { turnstile: { verified: boolean } }).turnstile.verified;
    expect([await me("203.0.113.7"), await me("198.51.100.9")]).toEqual([true, false]);
    const other = await fetchWith(withSecret, "/api/v1/me/ask", { method: "POST", cookie: both, headers: { "CF-Connecting-IP": "198.51.100.9" }, body: JSON.stringify({ question: "8월?" }) });
    expect(other.status).toBe(403);
  });

  it("위조·만료·세션 쿠키 값을 옮겨 붙인 쿠키는 통과하지 않는다", async () => {
    verifyReply({ success: true });
    const set = humanCookie(await verify(session)).split(";")[0]!;
    const [, value] = set.split("=");
    const [exp] = decodeURIComponent(value!).split(".");
    const forged = `copilot_human=${encodeURIComponent(`${Number(exp) + 1}.${decodeURIComponent(value!).split(".").slice(1).join(".")}`)}`;
    const sessionValue = session.split("=").slice(1).join("=");
    for (const c of [forged, `copilot_human=${sessionValue}`, "copilot_human=1700000000000.AAAA"]) expect((await ask(withSecret, `${session}; ${c}`)).status, c).toBe(403);
  });
});
