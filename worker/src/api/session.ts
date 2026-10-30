// 데모 세션(설계서 v0.1.12 §7, PHASES Phase 2 항목 1): 로그인이 없으므로 agentId는 서명 쿠키에서만 읽는다.
// POST /api/v1/demo/session {demoAgent: 1|2|3} → 활성 스트림 demo_agents의 그 번호 설계사로 HMAC 쿠키 발급.
// GET /api/v1/demo/agents → 공개 카드 3장. requireSession → /me/* 미들웨어(서명 + 요청마다 demo_agents 대조).
import { Hono } from "hono";
import { getSignedCookie, setSignedCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { activeStream, DEMO_TENANT, demoAgent, demoAgents, ScopedQuery } from "../db/ScopedQuery";
import { type AppEnv, compact, DISCLAIMER, invalidRequest, problem, unauthenticated } from "./http";

const COOKIE = "copilot_session";
const MAX_AGE = 7 * 24 * 60 * 60;

interface Profile {
  name: string;
  grade: string | null;
  org_path: string;
}

const isDemoNo = (n: unknown): n is 1 | 2 | 3 => n === 1 || n === 2 || n === 3;

export const demo = new Hono<AppEnv>();

demo.get("/agents", async (c) => {
  const stream = await activeStream(c.env.DB);
  if (!stream) return problem(c, 503, "INTERNAL_ERROR");
  const rows = await demoAgents(c.env.DB, DEMO_TENANT, stream);
  const items = await Promise.all(
    rows.map(async (r) => {
      // 카드의 이름·등급·소속은 그 설계사 범위의 질의로만 읽는다(규약 3)
      const q = new ScopedQuery(c.env.DB, { tenantId: DEMO_TENANT, agentId: r.agent_id, stream });
      const p = await q.first<Profile>("agent_profile", { columns: ["name", "grade", "org_path"] });
      return compact({ demoNo: r.demo_no, cardLabel: r.card_label, contractCount: r.contract_count, agentName: p?.name, grade: p?.grade, orgPath: p?.org_path });
    }),
  );
  return c.json({ streamHash: stream.streamHash, generatedAt: stream.generatedAt, items, disclaimer: DISCLAIMER }, 200, { "Cache-Control": "no-cache" });
});

demo.post("/session", async (c) => {
  const secret = c.env.SESSION_SECRET;
  if (!secret) return problem(c, 500, "INTERNAL_ERROR");
  const body = await c.req.json<unknown>().catch(() => null);
  const n = body && typeof body === "object" ? (body as { demoAgent?: unknown }).demoAgent : undefined;
  if (!isDemoNo(n) || Object.keys(body as object).length !== 1) return invalidRequest(c);
  const stream = await activeStream(c.env.DB);
  if (!stream) return problem(c, 503, "INTERNAL_ERROR");
  const row = await demoAgent(c.env.DB, DEMO_TENANT, stream, n);
  if (!row) return problem(c, 503, "INTERNAL_ERROR");
  await setSignedCookie(c, COOKIE, JSON.stringify({ a: row.agent_id, n }), secret, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: MAX_AGE });
  const q = new ScopedQuery(c.env.DB, { tenantId: DEMO_TENANT, agentId: row.agent_id, stream });
  const p = await q.first<Profile>("agent_profile", { columns: ["name", "grade", "org_path"] });
  return c.json(
    compact({ asOf: { streamHash: stream.streamHash, generatedAt: stream.generatedAt, demoNo: n }, agentId: row.agent_id, agentName: p?.name, disclaimer: DISCLAIMER }),
    200,
    { "Cache-Control": "no-store" },
  );
});

/** /me/*: 서명이 맞고, 활성 스트림의 그 데모 번호가 아직 같은 설계사일 때만 범위를 세운다. 아니면 같은 401. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const secret = c.env.SESSION_SECRET;
  if (!secret) return problem(c, 500, "INTERNAL_ERROR");
  const raw = await getSignedCookie(c, secret, COOKIE);
  if (!raw) return unauthenticated(c);
  let claim: { a?: unknown; n?: unknown };
  try {
    claim = JSON.parse(raw) as { a?: unknown; n?: unknown };
  } catch {
    return unauthenticated(c);
  }
  if (typeof claim.a !== "string" || !isDemoNo(claim.n)) return unauthenticated(c);
  const stream = await activeStream(c.env.DB);
  if (!stream) return problem(c, 503, "INTERNAL_ERROR");
  const row = await demoAgent(c.env.DB, DEMO_TENANT, stream, claim.n);
  if (!row || row.agent_id !== claim.a) return unauthenticated(c);
  c.set("scope", { q: new ScopedQuery(c.env.DB, { tenantId: DEMO_TENANT, agentId: row.agent_id, stream }), stream, agentId: row.agent_id, demoNo: claim.n });
  await next();
});
