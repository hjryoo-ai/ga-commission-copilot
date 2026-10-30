import { Hono } from "hono";
import { activeStream, cachedForStream, slotTable } from "../db/active-stream";

// D1 연결 확인 + 활성 스트림(설계서 v0.1.8 §5.1). 아키텍처 테스트 화이트리스트(test/arch.test.ts)에 등록되어 있다 —
// SELECT 1과 stream_meta(전역 표)만 tenant_id 없이 읽고, 읽기 모델 표 조회에는 tenant_id 조건을 둔다(화이트리스트여도 검사됨).
export const health = new Hono<{ Bindings: Env }>();

/** 데모 테넌트(gen/world/rules/tables.ts TENANT). */
const DEMO_TENANT = "T1";

health.get("/", async (c) => {
  const row = await c.env.DB.prepare("SELECT 1 AS one").first<{ one: number }>();
  const stream = await activeStream(c.env.DB);
  // 건수는 isolate당 스트림마다 한 번만 센다(5천여 행 읽기를 요청마다 반복하지 않는다)
  const earningsLines = stream
    ? await cachedForStream(stream, "earnings_line_count", async () => {
        const n = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${slotTable("earnings_line", stream.slot)} WHERE tenant_id = ?`)
          .bind(DEMO_TENANT)
          .first<{ n: number }>();
        return n?.n ?? 0;
      })
    : null;
  return c.json({ ok: true, d1: row?.one ?? null, streamHash: stream?.streamHash ?? null, earningsLines });
});
