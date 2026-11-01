// sim_stub 적재 SQL(설계서 §4.3·§5.1, 부록 A-07): 상위 엔진 시뮬레이션 샘플(contracts/sim/v1/samples — UPSTREAM·CHECKSUMS 고정)을
// 요청의 설계사·증권번호 행으로. 순수 함수 + 파일 읽기만 — 실행은 d1.ts(`load:d1 -- --local|--remote --sim-stub`).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../providers/prompt.ts";
import { sqlValue } from "./sql.ts";

const SIM_DIR = join(REPO_ROOT, "contracts/sim");

/** 적재할 샘플(요청 파일 이름 = 응답 파일 이름의 짝). 데모는 A-1 해약 7회차 하나(A-07). */
export const SIM_SAMPLES = ["event-cancel-7"] as const;

export interface SimStubRow {
  agentId: string;
  policyNo: string;
  kind: "POLICY_EVENT";
  response: string;
  ruleSnapshotId: string;
}

/** CHECKSUMS.upstream 대조 뒤 요청·응답 짝 → 행. 요청의 eventType이 정책 이벤트여야 한다. */
export function simStubRows(dir = SIM_DIR): SimStubRow[] {
  const sums = new Map(
    readFileSync(join(dir, "CHECKSUMS.upstream"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [h, f] = l.split(/\s+/);
        return [f!, h!] as const;
      }),
  );
  const read = (f: string) => {
    const text = readFileSync(join(dir, f), "utf8");
    const h = createHash("sha256").update(text).digest("hex");
    if (sums.get(f) !== h) throw new Error(`${f}: CHECKSUMS.upstream 불일치`);
    return JSON.parse(text) as Record<string, unknown>;
  };
  return SIM_SAMPLES.map((name) => {
    const req = read(`v1/samples/${name}.request.json`);
    const res = read(`v1/samples/${name}.response.json`);
    if (req.eventType !== "CANCEL" || typeof req.agentId !== "string" || typeof req.policyNo !== "string") throw new Error(`${name}: 정책 이벤트 요청 아님`);
    if (typeof res.ruleSnapshotId !== "string") throw new Error(`${name}: ruleSnapshotId 없음`);
    return { agentId: req.agentId, policyNo: req.policyNo, kind: "POLICY_EVENT", response: JSON.stringify(res), ruleSnapshotId: res.ruleSnapshotId };
  });
}

/** INSERT OR IGNORE(PK tenant_id·policy_no·kind — 같은 샘플을 다시 넣어도 그대로). */
export function simStubInserts(rows: readonly SimStubRow[], tenant: string): string[] {
  if (rows.length === 0) return [];
  return [
    "INSERT OR IGNORE INTO sim_stub (tenant_id, agent_id, policy_no, kind, response, rule_snapshot_id) VALUES\n" +
      rows.map((r) => `(${[tenant, r.agentId, r.policyNo, r.kind, r.response, r.ruleSnapshotId].map(sqlValue).join(", ")})`).join(",\n"),
  ];
}
