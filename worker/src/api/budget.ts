// GET /api/v1/budget(설계서 §7·v0.1.28, PHASES Phase 5 항목 6 — 공개, 세션 없음): 오늘·최근 7일 공급자별 사용, 폴백 깊이 분포, 캐시 적중, 거부 사유, 저하.
// budget_counter(전역 운영 표)만 읽는다 — 설계사 행·사용자 키(ip:…)는 내보내지 않는다. 값이 계속 바뀌어 no-store.
import { Hono } from "hono";
import { budgetCaps, budgetReport, withKeys } from "../llm/budget";
import { DISCLAIMER } from "./http";

export const budget = new Hono<{ Bindings: Env }>();

budget.get("/", async (c) => {
  const caps = withKeys(budgetCaps(c.env), c.env);
  const report = await budgetReport(c.env.DB, caps, new Date());
  return c.json({ ...report, caps, disclaimer: DISCLAIMER }, 200, { "Cache-Control": "no-store" });
});
