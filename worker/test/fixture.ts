// API 시험용 작은 세계(슬롯 a 활성). 시험 파일은 src가 아니라 아키텍처 스캔 대상이 아니다 — 슬롯 표에 직접 넣는다.
// 데모 설계사 1·2·3 = A-1001·A-1002·A-1003, 그 밖의 설계사 A-1009(타인 자원 인가 시험용).
import { env } from "cloudflare:test";

export const HASH = "e".repeat(64);
export const OTHER_HASH = "f".repeat(64);
export const GENERATED_AT = "2026-10-30T10:59:50.264Z";

type Row = Record<string, string | number | null>;

async function insert(table: string, row: Row): Promise<void> {
  const cols = Object.keys(row);
  await env.DB.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
    .bind(...Object.values(row))
    .run();
}

const BASIS = JSON.stringify({ payoutRate: "0.9", rate: "7", ruleVersionIds: ["COMM_RATE:FY_COMM/inst=null:rateId=1001,v=1"] });
const SUMMARY = JSON.stringify({ contractDate: "2026-08-01", monthlyPremium: 150000 });

function line(agent: string, calcId: string, policyNo: string, commType: string, amount: number, closeYm: string, seq: number, extra: Row = {}): Row {
  return {
    tenant_id: "T1",
    calc_id: calcId,
    agent_id: agent,
    policy_no: policyNo,
    product_key: "WHOLE-LIFE-20Y",
    comm_type: commType,
    amount,
    close_ym: closeYm,
    basis: BASIS,
    policy_summary: SUMMARY,
    source_seq: seq,
    ...extra,
  };
}

function month(agent: string, closeYm: string, gross: number, extra: Row = {}): Row {
  return { tenant_id: "T1", agent_id: agent, close_ym: closeYm, gross, clawback_offset: 0, adjustment: 0, status: "PROVISIONAL", last_seq: 1, ...extra };
}

function ledger(agent: string, ledgerId: string, policyNo: string, limit: number, accum: number): Row {
  return {
    tenant_id: "T1",
    ledger_id: ledgerId,
    agent_id: agent,
    policy_no: policyNo,
    contract_date: "2026-08-01",
    fy_start: "2026-08-01",
    fy_end: "2027-07-31",
    monthly_premium: 150000,
    limit_multiple: "12",
    limit_amount: limit,
    accum_paid: accum,
    rule_version_id: "1",
  };
}

const TABLES = [
  "agent_profile_a",
  "earnings_line_a",
  "earnings_month_a",
  "policy_limit_a",
  "policy_limit_history_a",
  "deferral_item_a",
  "clawback_item_a",
  "policy_flag_a",
  "demo_agents",
  "stream_meta",
];

export async function seed(): Promise<void> {
  for (const t of TABLES) await env.DB.prepare(`DELETE FROM ${t}`).run();
  await insert("stream_meta", { stream_hash: HASH, generated_at: GENERATED_AT, event_count: 100, plan_prompt_version: "plan/v1", verified_at: GENERATED_AT, active: 1, slot: "a", line_count: 9 });
  for (const [n, agent, label] of [
    [1, "A-1001", "한도 100% 소진 후 해약·환수 계약 보유"],
    [2, "A-1002", "분급제 계약 보유"],
    [3, "A-1003", "재산정으로 한도 초과·환수 상계 계약 보유"],
  ] as const) {
    await insert("demo_agents", { stream_hash: HASH, demo_no: n, tenant_id: "T1", agent_id: agent, scenario: `A${n}`, card_label: label, contract_count: n + 1, basis: "{}" });
  }
  for (const [agent, name] of [
    ["A-1001", "허구설계사01"],
    ["A-1002", "허구설계사02"],
    ["A-1003", "허구설계사03"],
    ["A-1009", "허구설계사09"],
  ] as const) {
    await insert("agent_profile_a", { tenant_id: "T1", agent_id: agent, name, grade: "SR", org_path: "/HQ1/BR01/TM01", status: "ACTIVE", valid_from: "2025-07-01", last_seq: 1 });
  }

  // A-1001: 202608(지급완료 — 같은 달 취소 짝 c3·c3r, 한도 삭감 c2) · 202609(예상 — 다른 달 취소 c5 → c1)
  for (const l of [
    line("A-1001", "1", "POL-2026-0001", "FY_COMM", 1_000_000, "202608", 10),
    line("A-1001", "c2", "POL-2026-0001", "INCENTIVE", 800_000, "202608", 11, { limit_cut_amt: 200_000, limit_cut_policy: "CUT" }),
    line("A-1001", "c3", "POL-2026-0002", "FY_COMM", 500_000, "202608", 12),
    line("A-1001", "c3r", "POL-2026-0002", "FY_COMM", -500_000, "202608", 13, { reversal_of_calc_id: "c3" }),
    line("A-1001", "c5", "POL-2026-0001", "FY_COMM", -1_000_000, "202609", 20, { reversal_of_calc_id: "1" }),
    line("A-1001", "c6", "POL-2026-0002", "RENEWAL", 300_000, "202609", 21),
    line("A-1001", "c7", "POL-2026-0002", "CLAWBACK", -100_000, "202609", 22),
  ]) {
    await insert("earnings_line_a", l);
  }
  await insert(
    "earnings_month_a",
    month("A-1001", "202608", 1_800_000, {
      status: "PAID",
      net_basis: "PAYOUT",
      withholding_tax: 59_400,
      net: 1_740_600,
      paid_amount: 1_740_600,
      paid_at: "2026-09-10T00:30:00Z",
      confirmed_at: "2026-09-01T00:30:00Z",
      payable: 1_740_600,
      receivable_offset: 0,
      carried_receivable: 0,
      run_seq: 3,
    }),
  );
  await insert("earnings_month_a", month("A-1001", "202609", -700_000, { clawback_offset: -100_000, status: "ESTIMATED", net_basis: "ESTIMATE", withholding_tax: 0, net: -800_000, estimate_as_of: "2026-10-01T00:30:00Z", estimate_basis_seq: 22 }));
  await insert("policy_limit_a", ledger("A-1001", "1", "POL-2026-0001", 1_800_000, 1_800_000));
  await insert("policy_limit_a", ledger("A-1001", "l-POL-2026-0002", "POL-2026-0002", 1_000_000, 850_000));
  await insert("policy_limit_history_a", { tenant_id: "T1", ledger_id: "1", source_seq: 10, posting_seq: 1, kind: "POST", calc_id: "1", amount: 1_000_000, accum_after: 1_000_000, limit_after: 1_800_000, occurred_at: "2026-08-01T00:00:00Z" });
  await insert("policy_limit_history_a", { tenant_id: "T1", ledger_id: "1", source_seq: 11, posting_seq: 2, kind: "POST", calc_id: "c2", amount: 800_000, accum_after: 1_800_000, limit_after: 1_800_000, occurred_at: "2026-08-02T00:00:00Z" });
  await insert("deferral_item_a", { tenant_id: "T1", schedule_id: "s-1", agent_id: "A-1001", policy_no: "POL-2026-0001", source_calc_id: "c2", due_ym: "202701", amount: 200_000, pay_condition: "POLICY_INFORCE", status: "SCHEDULED", reason: "LIMIT_DEFER", curve_version_id: "1", last_seq: 11 });
  await insert("clawback_item_a", { tenant_id: "T1", receivable_id: "r-A-1001-1", agent_id: "A-1001", origin_calc_id: "c7", amount: 100_000, remaining: 0, last_seq: 22, status: "CLOSED" });
  await insert("policy_flag_a", { tenant_id: "T1", policy_no: "POL-2026-0002", agent_id: "A-1001", flag_type: "OVERDUE", occurred_on: "2026-09-15", reason: "PAYMENT_OVERDUE" });
  await insert("policy_flag_a", { tenant_id: "T1", policy_no: "POL-2026-0001", agent_id: "A-1001", flag_type: "LAPSED", occurred_on: "2026-09-01", cleared_at: "2026-09-20T00:00:00Z", reason: "LAPSE" });

  // A-1002·A-1003·A-1009: 한 달·한 라인
  await insert("earnings_line_a", line("A-1002", "d1", "POL-2027-0002", "FY_COMM", 400_000, "202608", 30));
  await insert("earnings_month_a", month("A-1002", "202608", 400_000));
  await insert("earnings_line_a", line("A-1003", "e1", "POL-2026-0004", "FY_COMM", 600_000, "202607", 31));
  await insert("earnings_month_a", month("A-1003", "202607", 600_000));
  await insert("earnings_line_a", line("A-1009", "z1", "POL-2026-9999", "FY_COMM", 700_000, "202608", 40));
  await insert("earnings_month_a", month("A-1009", "202608", 700_000));
  await insert("policy_limit_a", ledger("A-1009", "l-POL-2026-9999", "POL-2026-9999", 1_000_000, 700_000));
  await insert("policy_limit_history_a", { tenant_id: "T1", ledger_id: "l-POL-2026-9999", source_seq: 40, posting_seq: 1, kind: "POST", calc_id: "z1", amount: 700_000, accum_after: 700_000, limit_after: 1_000_000, occurred_at: "2026-08-01T00:00:00Z" });
}

/** 데모 번호로 세션을 열고 쿠키 머리 값을 돌려준다. */
export async function login(fetcher: { fetch(req: Request): Promise<Response> }, demoAgent: 1 | 2 | 3): Promise<string> {
  const res = await fetcher.fetch(new Request("https://example.com/api/v1/demo/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ demoAgent }) }));
  if (res.status !== 200) throw new Error(`session ${res.status} ${await res.text()}`);
  const set = res.headers.get("Set-Cookie") ?? "";
  return set.split(";")[0]!;
}
