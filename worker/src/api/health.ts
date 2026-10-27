import { Hono } from "hono";

// 테넌트 데이터를 읽지 않는 D1 연결 확인. 아키텍처 테스트 화이트리스트(test/arch.test.ts)에 등록되어 있다.
export const health = new Hono<{ Bindings: Env }>();

health.get("/", async (c) => {
  const row = await c.env.DB.prepare("SELECT 1 AS one").first<{ one: number }>();
  return c.json({ ok: true, d1: row?.one ?? null });
});
