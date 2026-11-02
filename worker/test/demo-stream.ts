// 답변 재생 시험용 실제 데모 설계사 행(운영자 2026-11-02). test/fixtures/demo-stream.json은 gen/scripts/answer-fixture.ts가 만든다 — 손으로 고치지 않는다.
// 녹화(로컬 D1, 같은 스트림)와 툴 결과·검색 청크 본문이 같아야 카세트 요청 해시가 맞는다. 작은 가짜 세계(fixture.ts)와 섞지 않는다 — 시험 D1을 비우고 넣는다.
import { env } from "cloudflare:test";
import fixture from "./fixtures/demo-stream.json";

export const DEMO_STREAM = fixture as { streamHash: string; rulebookVersion: string; slot: "a"; demoAgents: { demoNo: number; agentId: string }[]; counts: Record<string, number>; statements: string[] };

const CLEAR = [
  "agent_profile_a",
  "earnings_line_a",
  "earnings_month_a",
  "policy_limit_a",
  "policy_limit_history_a",
  "deferral_item_a",
  "clawback_item_a",
  "policy_flag_a",
  "explanation",
  "demo_agents",
  "stream_meta",
  "rulebook_chunk",
  "sim_stub",
  "answer_log",
  "budget_counter",
];

export async function seedDemoStream(): Promise<void> {
  for (const t of CLEAR) await env.DB.prepare(`DELETE FROM ${t}`).run();
  for (const s of DEMO_STREAM.statements) await env.DB.prepare(s).run();
}
