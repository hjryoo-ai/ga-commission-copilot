// G3 필수 케이스(설계서 v0.1.11 §4.2, 상위 설계서 v1.9 부록 B "반드시 포함할 케이스" 8종 — 경계 넷은 날짜별 4항목 — + §4.1(a) A-1 payload 동등
// + 데모 설계사 3명 선정).
// 스트림만 본다(플랜을 믿지 않는다). 항목마다 PASS/FAIL과 근거(seq·키)를 남긴다. 금액은 계산하지 않는다 — 소진율만(누적 ÷ 한도, 정수 %).
import type { Envelope } from "../world/expand.ts";
import { A1_RESERVED } from "../world/forced.ts";
import { a1GoldenProblems } from "../world/golden.ts";
import { CURVE_FROM, LIMIT_FROM } from "../world/rules/tables.ts";
import { addDays } from "../world/calendar.ts";

export type Status = "PASS" | "FAIL";

export interface CaseResult {
  id: string;
  title: string;
  status: Status;
  detail: string;
}

type P = Record<string, any>;
const p = (e: Envelope) => e.payload as P;
const result = (id: string, title: string, ok: boolean, detail: string): CaseResult => ({ id, title, status: ok ? "PASS" : "FAIL", detail });

/** 원장별 최대 소진율(%, 내림) — 양수 전기 뒤 누적 ÷ 그때 한도. */
function maxUsage(events: readonly Envelope[]): Map<string, number> {
  const limit = new Map<string, number>();
  const max = new Map<string, number>();
  for (const e of events) {
    if (e.type === "LimitLedgerOpened") limit.set(p(e).ledgerId, p(e).limitAmount);
    if (e.type === "LimitLedgerRebased") limit.set(p(e).ledgerId, p(e).newLimit);
    if (e.type === "LimitLedgerPosted" && p(e).amount > 0) {
      const l = limit.get(p(e).ledgerId);
      if (l) max.set(p(e).ledgerId, Math.max(max.get(p(e).ledgerId) ?? 0, Math.floor((p(e).accumAfter * 100) / l)));
    }
  }
  return max;
}

function limitBands(events: readonly Envelope[]): CaseResult {
  const usage = [...maxUsage(events).entries()];
  const band = (lo: number, hi: number) => usage.filter(([, x]) => x >= lo && x < hi).map(([id]) => id);
  const b80 = band(80, 95);
  const b95 = band(95, 100);
  const b100 = usage.filter(([, x]) => x >= 100).map(([id]) => id);
  return result(
    "LIMIT_80_95_100",
    "한도 소진 80%대·95%대·100% 각 1건 이상",
    b80.length > 0 && b95.length > 0 && b100.length > 0,
    `80%대 ${b80.length}(${b80[0] ?? "-"}) · 95%대 ${b95.length}(${b95[0] ?? "-"}) · 100% ${b100.length}(${b100[0] ?? "-"})`,
  );
}

function cutAndDefer(events: readonly Envelope[]): CaseResult {
  const cut = (policy: string) => events.filter((e) => e.type === "CommissionCalculated" && p(e).limitCutPolicy === policy && p(e).limitCutAmt > 0);
  const c = cut("CUT");
  const d = cut("DEFER_AFTER_FY");
  return result(
    "CUT_AND_DEFER",
    "한도 초과 삭감(CUT)·이연(DEFER_AFTER_FY) 라인 각 1건 이상",
    c.length > 0 && d.length > 0,
    `CUT ${c.length}(첫 seq ${c[0]?.seq ?? "-"}) · DEFER_AFTER_FY ${d.length}(첫 seq ${d[0]?.seq ?? "-"})`,
  );
}

function rebase(events: readonly Envelope[]): CaseResult {
  const r = events.filter((e) => e.type === "LimitLedgerRebased");
  return result("REBASE", "한도 재산정 1건 이상", r.length > 0, `LimitLedgerRebased ${r.length}(첫 seq ${r[0]?.seq ?? "-"} ${r[0] ? p(r[0]).ledgerId : ""})`);
}

function deferralHeld(events: readonly Envelope[]): CaseResult {
  const h = events.filter((e) => e.type === "DeferralStatusChanged" && p(e).to === "HELD");
  return result("DEFERRAL_HELD", "HELD 분급 1건 이상", h.length > 0, `HELD ${h.length}(첫 seq ${h[0]?.seq ?? "-"} ${h[0] ? p(h[0]).scheduleId : ""})`);
}

function receivableCarried(events: readonly Envelope[]): CaseResult {
  const open = events.filter((e) => e.type === "ClawbackReceivableUpdated" && p(e).status === "OPEN");
  const settled = new Set(events.filter((e) => e.type === "ClawbackReceivableUpdated" && ["OFFSET", "CLOSED"].includes(p(e).status)).map((e) => p(e).receivableId));
  const later = open.filter((e) => settled.has(p(e).receivableId)).length;
  return result(
    "RECEIVABLE_CARRIED",
    "환수 채권 이월(OPEN) 1건 이상",
    open.length > 0,
    `OPEN ${open.length}(첫 seq ${open[0]?.seq ?? "-"}) · 그중 뒤에 상계·종결 ${later}`,
  );
}

function reversalPair(events: readonly Envelope[]): CaseResult {
  const calc = new Set<string>();
  const pairs: Envelope[] = [];
  for (const e of events) {
    if (e.type !== "CommissionCalculated") continue;
    if (p(e).reversalOfCalcId && calc.has(p(e).reversalOfCalcId)) pairs.push(e);
    calc.add(p(e).calcId);
  }
  return result(
    "REVERSAL_PAIR",
    "취소·재분개 짝(reversalOfCalcId가 앞선 라인을 가리킴) 1건 이상",
    pairs.length > 0,
    `짝 ${pairs.length}(첫 seq ${pairs[0]?.seq ?? "-"} ${pairs[0] ? `${p(pairs[0]).calcId}→${p(pairs[0]).reversalOfCalcId}` : ""})`,
  );
}

function adjustmentAfterClose(events: readonly Envelope[]): CaseResult {
  const lineMonth = new Map<string, string>();
  const closed = new Set<string>();
  const hits: Envelope[] = [];
  for (const e of events) {
    if (e.type === "CommissionCalculated") lineMonth.set(p(e).calcId, `${p(e).agentId}:${p(e).closeYm}`);
    if (e.type === "StatementConfirmed") closed.add(`${p(e).agentId}:${p(e).closeYm}`);
    if (e.type === "AdjustmentPosted") {
      const target = lineMonth.get(p(e).targetCalcId);
      if (target && closed.has(target)) hits.push(e);
    }
  }
  return result(
    "ADJUSTMENT_AFTER_CLOSE",
    "마감 후 조정(대상 라인의 달이 이미 확정된 뒤 AdjustmentPosted) 1건 이상",
    hits.length > 0,
    `${hits.length}(첫 seq ${hits[0]?.seq ?? "-"} ${hits[0] ? `${p(hits[0]).adjId} → ${p(hits[0]).targetCalcId}` : ""})`,
  );
}

/** 경계 넷(항목 넷): 시행일 전날·당일에 체결된 계약이 있고, 규칙이 그 날짜에서 갈린다(체결 FY 라인의 policySummary.contractDate 기준). */
function boundaries(events: readonly Envelope[]): CaseResult[] {
  const fyByDate = new Map<string, string[]>();
  for (const e of events) {
    if (e.type === "CommissionCalculated" && p(e).commType === "FY_COMM" && !p(e).reversalOfCalcId) {
      const d: string = p(e).policySummary?.contractDate;
      fyByDate.set(d, [...(fyByDate.get(d) ?? []), p(e).policyNo]);
    }
  }
  const ledger = new Set(events.filter((e) => e.type === "LimitLedgerOpened").map((e) => p(e).policyNo));
  const curve = new Set(events.filter((e) => e.type === "DeferralScheduled" && p(e).reason === "CURVE").map((e) => p(e).policyNo));
  const checks: [string, string, string, (policyNo: string) => boolean][] = [
    ["BOUNDARY_LIMIT_BEFORE", addDays(LIMIT_FROM, -1), "한도 미적용(원장 없음)", (n) => !ledger.has(n)],
    ["BOUNDARY_LIMIT_AFTER", LIMIT_FROM, "한도 적용(원장 있음)", (n) => ledger.has(n)],
    ["BOUNDARY_DEFERRAL_BEFORE", addDays(CURVE_FROM, -1), "분급 미적용(커브 스케줄 없음)", (n) => !curve.has(n)],
    ["BOUNDARY_DEFERRAL_AFTER", CURVE_FROM, "분급 적용(커브 스케줄 있음)", (n) => curve.has(n)],
  ];
  return checks.map(([id, date, rule, holds]) => {
    const policies = fyByDate.get(date) ?? [];
    const good = policies.filter(holds);
    return result(id, `경계 — ${date} 체결 계약이 ${rule}`, good.length > 0 && good.length === policies.length, `${date} 체결 ${policies.length}건 중 ${rule} ${good.length}건${good[0] ? `(${good[0]})` : ""}`);
  });
}

function a1Golden(events: readonly Envelope[]): CaseResult {
  const problems = a1GoldenProblems(events);
  return result("A1_GOLDEN", "A-1 계약 11건이 상위 정본 스트림과 payload 필드 단위로 동등(설계서 §4.1(a))", problems.length === 0, problems.length === 0 ? "11건 동등·순서 일치" : problems.slice(0, 3).join(" | "));
}

/** 데모 설계사 카드 문구(설계서 §8 화면 1 — demo_agents.card_label 그대로). */
export const DEMO_CARD_LABELS = { 1: "한도 100% 소진 후 해약·환수 계약 보유", 2: "분급제 계약 보유", 3: "재산정으로 한도 초과·환수 상계 계약 보유" } as const;

export interface DemoAgent {
  demoNo: 1 | 2 | 3;
  agentId: string;
  scenario: "A1" | "A2" | "A3";
  cardLabel: string;
  /** 그 설계사 라인의 서로 다른 증권 수(earnings_line의 policy_no 수와 같다). */
  contractCount: number;
  basis: Record<string, string | number>;
}

/**
 * 데모 설계사 선정(설계서 v0.1.11 §4.1(a)) — 스트림만 보고 결정론으로 고른다.
 * 1: A-1 정본 원장의 설계사(그 설계사 원장 중 이력상 누적이 한도에 닿은 것이 있어야 한다 — 끝 상태가 아니다).
 * 2: HELD 전이를 seq 순으로 보며, 커브 스케줄과 RELEASED가 있는 첫 설계사(1과 다름).
 * 3: 재산정을 seq 순으로 보며, 환수 채권이 OPEN 뒤 OFFSET까지 간 첫 설계사(1·2와 다름).
 * 못 채운 번호는 빠진다 — 3명이 아니면 G3 DEMO_AGENTS FAIL.
 */
export function selectDemoAgents(events: readonly Envelope[]): DemoAgent[] {
  const ledgerAgent = new Map<string, string>();
  const scheduleAgent = new Map<string, string>();
  const policies = new Map<string, Set<string>>();
  const curve = new Map<string, number>();
  const released = new Map<string, number>();
  type Receivable = { agentId: string; openSeq?: number; offsetSeq?: number };
  const receivable = new Map<string, Receivable>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const e of events) {
    const x = p(e);
    if (e.type === "LimitLedgerOpened") ledgerAgent.set(x.ledgerId, x.agentId);
    if (e.type === "DeferralScheduled") {
      scheduleAgent.set(x.scheduleId, x.agentId);
      if (x.reason === "CURVE") bump(curve, x.agentId);
    }
    if (e.type === "DeferralStatusChanged" && x.to === "RELEASED") bump(released, scheduleAgent.get(x.scheduleId) ?? "");
    if (e.type === "CommissionCalculated") policies.set(x.agentId, (policies.get(x.agentId) ?? new Set()).add(x.policyNo));
    if (e.type === "ClawbackReceivableUpdated") {
      const r: Receivable = receivable.get(x.receivableId) ?? { agentId: x.agentId };
      if (x.status === "OPEN") r.openSeq ??= e.seq;
      if (x.status === "OFFSET" && r.openSeq !== undefined) r.offsetSeq ??= e.seq;
      receivable.set(x.receivableId, r);
    }
  }
  const usage = maxUsage(events);
  const picked: DemoAgent[] = [];
  const taken = (agentId: string) => picked.some((d) => d.agentId === agentId);
  const pick = (demoNo: 1 | 2 | 3, agentId: string, basis: DemoAgent["basis"]) =>
    picked.push({ demoNo, agentId, scenario: `A${demoNo}`, cardLabel: DEMO_CARD_LABELS[demoNo], contractCount: policies.get(agentId)?.size ?? 0, basis });

  const a1 = ledgerAgent.get(A1_RESERVED.ledgerId);
  const full = a1 ? [...usage.entries()].find(([id, u]) => u >= 100 && ledgerAgent.get(id) === a1) : undefined;
  if (a1 && full) pick(1, a1, { fullLedgerId: full[0], usagePct: full[1] });

  for (const e of events) {
    if (e.type !== "DeferralStatusChanged" || p(e).to !== "HELD") continue;
    const agentId = scheduleAgent.get(p(e).scheduleId);
    if (!agentId || taken(agentId) || !curve.get(agentId) || !released.get(agentId)) continue;
    pick(2, agentId, { heldSeq: e.seq, scheduleId: p(e).scheduleId, curveSchedules: curve.get(agentId)!, released: released.get(agentId)! });
    break;
  }

  for (const e of events) {
    if (e.type !== "LimitLedgerRebased") continue;
    const agentId = ledgerAgent.get(p(e).ledgerId);
    if (!agentId || taken(agentId)) continue;
    const r = [...receivable.entries()].find(([, v]) => v.agentId === agentId && v.offsetSeq !== undefined);
    if (!r) continue;
    pick(3, agentId, { rebaseSeq: e.seq, ledgerId: p(e).ledgerId, receivableId: r[0], openSeq: r[1].openSeq!, offsetSeq: r[1].offsetSeq! });
    break;
  }
  return picked;
}

function demoAgents(events: readonly Envelope[]): CaseResult {
  const picked = selectDemoAgents(events);
  const missing = ([1, 2, 3] as const).filter((n) => !picked.some((d) => d.demoNo === n));
  return result(
    "DEMO_AGENTS",
    "데모 설계사 3명 선정(설계서 §4.1(a) 규칙 — A-1·분급제·재산정+환수 상계)",
    missing.length === 0,
    [...picked.map((d) => `${d.demoNo} ${d.agentId}(${Object.values(d.basis).join(" ")})`), ...missing.map((n) => `${n} 없음`)].join(" · "),
  );
}

export function requiredCases(events: readonly Envelope[]): CaseResult[] {
  return [
    limitBands(events),
    cutAndDefer(events),
    rebase(events),
    deferralHeld(events),
    receivableCarried(events),
    reversalPair(events),
    adjustmentAfterClose(events),
    ...boundaries(events),
    a1Golden(events),
    demoAgents(events),
  ];
}
