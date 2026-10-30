// 적재 후 전수 재검증(설계서 §5.4 두 번째 불변식, PHASES Phase 3 항목 4):
// D1의 explanation 행 중 grounding_status='PASS'인 것마다, 같은 D1 슬롯 표에서 컨텍스트를 다시 만들고 G4(텍스트·numbers_used)·G5·G6을 다시 돌린다.
// 생성 때와 다른 데이터(다른 슬롯·다른 스트림)를 읽으면 위반이 나온다 — 검증기·적재기 버그 방어.
import { gateExplanation } from "@copilot/grounding";
import type { D1Exec } from "../load/flow.ts";
import { type Slot, slotTable, sqlValue } from "../load/sql.ts";
import { TENANT } from "../world/rules/tables.ts";
import { type AgentRows, contextOf, type Kind, type Row } from "./context.ts";

export interface RecheckReport {
  streamHash: string;
  slot: Slot;
  active: boolean;
  rows: number;
  pass: number;
  fail: number;
  byKind: Record<string, { pass: number; fail: number }>;
  /** PASS 행인데 재검증에 걸린 것(0이어야 한다). */
  violations: { kind: string; agentId: string; subjectId: string; promptVersion: string; problems: string[] }[];
}

const JSON_COLS: Readonly<Record<string, readonly string[]>> = { earnings_line: ["basis", "policy_summary"] };

function parseRow(table: string, r: Row): Row {
  const out = { ...r };
  for (const c of JSON_COLS[table] ?? []) if (typeof out[c] === "string") out[c] = JSON.parse(out[c] as string);
  return out;
}

/** D1 슬롯 표에서 한 설계사 행(gen/explain/context.ts AgentRows). */
export function agentRowsFromD1(db: D1Exec, slot: Slot, agentId: string, tenant = TENANT): AgentRows {
  const where = `tenant_id = ${sqlValue(tenant)} AND agent_id = ${sqlValue(agentId)}`;
  const q = (t: string) => db.query(`SELECT * FROM ${slotTable(t, slot)} WHERE ${where}`).map((r) => parseRow(t, r));
  return {
    agentId,
    earnings_line: q("earnings_line"),
    earnings_month: q("earnings_month"),
    policy_limit: q("policy_limit"),
    policy_limit_history: db.query(
      `SELECT * FROM ${slotTable("policy_limit_history", slot)} WHERE tenant_id = ${sqlValue(tenant)} AND ledger_id IN (SELECT ledger_id FROM ${slotTable("policy_limit", slot)} WHERE ${where})`,
    ),
    deferral_item: q("deferral_item"),
    clawback_item: q("clawback_item"),
  };
}

export function recheckExplanations(db: D1Exec, hashArg?: string, tenant = TENANT): RecheckReport {
  const metas = db.query("SELECT stream_hash, slot, active FROM stream_meta") as { stream_hash: string; slot: Slot; active: number }[];
  const meta = hashArg ? metas.find((m) => m.stream_hash === hashArg) : metas.find((m) => m.active === 1);
  if (!meta) throw new Error(hashArg ? `stream_meta에 ${hashArg.slice(0, 12)} 없음` : "활성 스트림 없음");
  const hash = meta.stream_hash;
  const rows = db.query(
    `SELECT agent_id, kind, subject_id, prompt_version, text, cited_fields, numbers_used, grounding_status FROM explanation WHERE tenant_id = ${sqlValue(tenant)} AND stream_hash = ${sqlValue(hash)} ORDER BY agent_id, kind, subject_id`,
  ) as { agent_id: string; kind: Kind; subject_id: string; prompt_version: string; text: string; cited_fields: string; numbers_used: string; grounding_status: string }[];
  const report: RecheckReport = { streamHash: hash, slot: meta.slot, active: meta.active === 1, rows: rows.length, pass: 0, fail: 0, byKind: {}, violations: [] };
  const agents = new Map<string, AgentRows>();
  for (const r of rows) {
    const k = (report.byKind[r.kind] ??= { pass: 0, fail: 0 });
    if (r.grounding_status !== "PASS") {
      report.fail++;
      k.fail++;
      continue;
    }
    report.pass++;
    k.pass++;
    if (!agents.has(r.agent_id)) agents.set(r.agent_id, agentRowsFromD1(db, meta.slot, r.agent_id, tenant));
    const ctx = contextOf(agents.get(r.agent_id)!, r.kind, r.subject_id);
    const problems: string[] = [];
    if (!ctx) problems.push("subject가 슬롯 표에 없다");
    else {
      const g = gateExplanation({ text: r.text, citedFields: JSON.parse(r.cited_fields) as string[], numbersUsed: JSON.parse(r.numbers_used) as string[] }, ctx, { ownAgentId: r.agent_id });
      problems.push(...g.g4.map((x) => `G4 ${x}`), ...g.g5.map((x) => `G5 ${x}`), ...g.g6.map((x) => `G6 ${x}`));
    }
    if (problems.length) report.violations.push({ kind: r.kind, agentId: r.agent_id, subjectId: r.subject_id, promptVersion: r.prompt_version, problems });
  }
  return report;
}
