import { Hono } from "hono";
import { activeStream, DEMO_TENANT, ping, tenantLineCount } from "../db/ScopedQuery";

// D1 연결 확인 + 활성 스트림(설계서 v0.1.10 §5.1). D1 접근은 db/ScopedQuery.ts의 함수로만 한다.
export const health = new Hono<{ Bindings: Env }>();

health.get("/", async (c) => {
  const d1 = await ping(c.env.DB);
  const stream = await activeStream(c.env.DB);
  const earningsLines = stream ? await tenantLineCount(c.env.DB, DEMO_TENANT, stream) : null;
  return c.json({ ok: true, d1, streamHash: stream?.streamHash ?? null, earningsLines });
});
