import { Hono } from "hono";
import { activeStream, ping } from "../db/ScopedQuery";

// D1 연결 확인 + 활성 스트림(설계서 v0.1.11 §5.1). stream_meta 한 행만 읽는다 — 라인 수는 적재기가 ⑤ 재검사에서 쓴 line_count.
export const health = new Hono<{ Bindings: Env }>();

health.get("/", async (c) => {
  const d1 = await ping(c.env.DB);
  const stream = await activeStream(c.env.DB);
  return c.json({ ok: true, d1, streamHash: stream?.streamHash ?? null, earningsLines: stream?.lineCount ?? null });
});
