// 플랜 → 이벤트 스트림(JSONL) 결정론 전개(설계서 §4.1(a)-2, Phase 1 항목 3). LLM 호출 없음.
// 같은 플랜 → 바이트 동일 스트림. 금액은 rules/만 계산한다. 이벤트 모양은 상위 계약 contracts/events/v1과 엔진 골든 스트림을 따른다.
//   node world/expand.ts            gen/out/plan.json → gen/out/stream.jsonl (+ stream.meta.json)
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENTS, agent as agentOf } from "./agents.ts";
import { addDays, addMonths, at, dateIn, fyEndOf, monthsBetween, ymOf } from "./calendar.ts";
import { A1_RESERVED } from "./forced.ts";
import type { LifecycleEventType, Plan, PlanContract } from "./plan-types.ts";
import { floorTo, mulFloor, sum } from "./rules/money.ts";
import {
  ADJUSTMENT_RATE,
  ADJUSTMENT_REASON,
  CAMPAIGNS,
  CLOCK,
  CONTRACT_FROM,
  CURVE,
  CURVE_FROM,
  clawbackRate,
  HORIZON_YM,
  LIMIT_FROM,
  LIMIT_MULTIPLE,
  LIMIT_RULE_ID,
  PAY_CONDITION,
  PAYOUT_RATE,
  type Product,
  product,
  REBASE_REASON,
  REDUCE_SHARE,
  ruleFrom,
  WITHHOLDING_RATE,
} from "./rules/tables.ts";

export interface Envelope {
  eventId: string;
  seq: number;
  type: string;
  version: 1;
  occurredAt: string;
  aggregate: { kind: string; id: string };
  payload: Record<string, unknown>;
}

interface Line {
  calcId: string;
  commType: string;
  amount: number;
  closeYm: string;
  basis: Record<string, unknown>;
  posted: number;
  reversed: boolean;
}

interface Schedule {
  scheduleId: string;
  sourceCalcId: string;
  dueYm: string;
  amount: number;
  status: "SCHEDULED" | "RELEASED" | "HELD" | "CANCELLED";
}

interface Ledger {
  ledgerId: string;
  limit: number;
  accum: number;
  postingSeq: number;
  fyEnd: string;
}

interface Policy {
  c: PlanContract;
  /** 계약 키(설계서 v0.1.13 §4.1(a)): 설계사 키 + 설계사 내 계약 순번 — 생성 ID에 증권번호를 넣지 않는다. */
  key: string;
  prod: Product;
  grade: string;
  premium: number;
  status: "INFORCE" | "LAPSED" | "ENDED";
  ledger: Ledger | null;
  lines: Line[];
  schedules: Schedule[];
  calcSeq: number;
  hasIncentive: boolean;
  adjusted: boolean;
}

interface Month {
  gross: number;
  clawbackOffset: number;
  adjustment: number;
  negativeCalcIds: string[];
  clawbackCalcIds: string[];
  closed: boolean;
  payout: Record<string, unknown> | null;
}

interface Receivable {
  receivableId: string;
  originCalcId: string;
  amount: number;
  remaining: number;
  status: "OPEN" | "OFFSET" | "CLOSED";
}

interface AgentState {
  lastSeq: number;
  months: Map<string, Month>;
  receivables: Receivable[];
  receivableSeq: number;
  pendingEstimates: Set<string>;
}

/** UUIDv7 모양의 결정론 eventId: 앞 48비트 = occurredAt 밀리초, 나머지 = sha256(seq). */
export function eventIdOf(occurredAt: string, seq: number): string {
  const ms = Date.parse(occurredAt).toString(16).padStart(12, "0");
  const h = createHash("sha256").update(`ga-copilot-event:${seq}`).digest("hex");
  const variant = ((parseInt(h[3]!, 16) & 0x3) | 0x8).toString(16);
  return `${ms.slice(0, 8)}-${ms.slice(8, 12)}-7${h.slice(0, 3)}-${variant}${h.slice(4, 7)}-${h.slice(7, 19)}`;
}

function lifecycleDate(c: PlanContract, ym: string): string {
  const contractDay = Number(c.contractDate.slice(8, 10));
  const day = ymOf(c.contractDate) === ym ? Math.max(CLOCK.policyEventDay, contractDay) : CLOCK.policyEventDay;
  return dateIn(ym, day);
}

/** 세계 마지막 시각: HORIZON_YM 마감분 지급일. */
export function worldEndDate(): string {
  return dateIn(addMonths(HORIZON_YM, 1), CLOCK.payoutDay);
}

/** 설계사 키: ID의 하이픈을 뺀 값(A-1003 → A1003). */
const agentKey = (agentId: string) => agentId.replace(/-/g, "");

export function expand(plan: Plan): Envelope[] {
  const events: Envelope[] = [];
  const agents = new Map<string, AgentState>(AGENTS.map((a) => [a.agentId, { lastSeq: 0, months: new Map(), receivables: [], receivableSeq: 0, pendingEstimates: new Set() }]));
  const policies: Policy[] = [...plan.contracts]
    .sort((x, y) => x.agentId.localeCompare(y.agentId) || x.policyNo.localeCompare(y.policyNo))
    .map((c) => ({
      c,
      key: "",
      prod: product(c.productKey),
      grade: agentOf(c.agentId).grade,
      premium: c.monthlyPremium,
      status: "INFORCE",
      ledger: null,
      lines: [],
      schedules: [],
      calcSeq: 0,
      hasIncentive: false,
      adjusted: false,
    }));
  // 설계사 내 계약 순번: 체결일·증권번호 순, 2자리 이상(예 A1003-07)
  const byAgent = new Map<string, Policy[]>();
  for (const p of policies) byAgent.set(p.c.agentId, [...(byAgent.get(p.c.agentId) ?? []), p]);
  for (const list of byAgent.values()) {
    const width = Math.max(2, String(list.length).length);
    [...list]
      .sort((x, y) => x.c.contractDate.localeCompare(y.c.contractDate) || x.c.policyNo.localeCompare(y.c.policyNo))
      .forEach((p, i) => (p.key = `${agentKey(p.c.agentId)}-${String(i + 1).padStart(width, "0")}`));
  }
  const byContractDate = new Map<string, Policy[]>();
  const byEventDate = new Map<string, { p: Policy; event: LifecycleEventType }[]>();
  for (const p of policies) {
    byContractDate.set(p.c.contractDate, [...(byContractDate.get(p.c.contractDate) ?? []), p]);
    for (const e of p.c.lifecycle) {
      const d = lifecycleDate(p.c, e.ym);
      byEventDate.set(d, [...(byEventDate.get(d) ?? []), { p, event: e.event }]);
    }
  }

  let today = "";
  const emit = (time: string, type: string, kind: string, id: string, agentId: string | null, payload: Record<string, unknown>): number => {
    const seq = events.length + 1;
    const occurredAt = at(today, time);
    events.push({ eventId: eventIdOf(occurredAt, seq), seq, type, version: 1, occurredAt, aggregate: { kind, id }, payload });
    if (agentId) agents.get(agentId)!.lastSeq = seq;
    return seq;
  };
  const month = (agentId: string, ym: string): Month => {
    const st = agents.get(agentId)!;
    let m = st.months.get(ym);
    if (!m) {
      m = { gross: 0, clawbackOffset: 0, adjustment: 0, negativeCalcIds: [], clawbackCalcIds: [], closed: false, payout: null };
      st.months.set(ym, m);
    }
    return m;
  };
  const nextCalcId = (p: Policy): string => {
    p.calcSeq++;
    if (p.c.forcedCase === "A1") {
      const id = A1_RESERVED.calcIds[p.calcSeq - 1];
      if (!id) throw new Error("A-1 계약의 예약 calcId 3개를 넘었다");
      return id;
    }
    return `c-${p.key}-${p.calcSeq}`;
  };
  const policySummary = (p: Policy) => ({ contractDate: p.c.contractDate, monthlyPremium: p.premium });

  const addLine = (time: string, p: Policy, commType: string, amount: number, extra: { limitCutAmt?: number; limitCutPolicy?: string; reversalOf?: string; basis: Record<string, unknown> }, calcId = nextCalcId(p)): Line => {
    const closeYm = ymOf(today);
    const m = month(p.c.agentId, closeYm);
    if (m.closed) throw new Error(`마감월 ${closeYm}에 라인(${p.c.policyNo})`);
    const payload: Record<string, unknown> = {
      calcId,
      agentId: p.c.agentId,
      policyNo: p.c.policyNo,
      productKey: p.c.productKey,
      commType,
      amount,
      closeYm,
    };
    if (extra.reversalOf) payload.reversalOfCalcId = extra.reversalOf;
    payload.limitCutAmt = extra.limitCutAmt ?? 0;
    if (extra.limitCutPolicy) payload.limitCutPolicy = extra.limitCutPolicy;
    payload.basis = extra.basis;
    payload.policySummary = policySummary(p);
    emit(time, "CommissionCalculated", "COMM_CALC", calcId, p.c.agentId, payload);
    if (commType === "CLAWBACK") {
      m.clawbackOffset = sum([m.clawbackOffset, amount]);
      m.clawbackCalcIds.push(calcId);
    } else {
      m.gross = sum([m.gross, amount]);
    }
    if (amount < 0) m.negativeCalcIds.push(calcId);
    agents.get(p.c.agentId)!.pendingEstimates.add(closeYm);
    const line: Line = { calcId, commType, amount, closeYm, basis: extra.basis, posted: 0, reversed: false };
    p.lines.push(line);
    return line;
  };
  const post = (time: string, p: Policy, line: Line, amount: number): void => {
    const l = p.ledger;
    if (!l || amount === 0) return;
    l.postingSeq++;
    l.accum = sum([l.accum, amount]);
    if (l.accum < 0 || (amount > 0 && l.accum > l.limit)) throw new Error(`원장 ${l.ledgerId} 불변식 위반`);
    line.posted = sum([line.posted, amount]);
    emit(time, "LimitLedgerPosted", "LIMIT_LEDGER", l.ledgerId, p.c.agentId, {
      ledgerId: l.ledgerId,
      postingSeq: l.postingSeq,
      calcId: line.calcId,
      amount,
      accumAfter: l.accum,
    });
  };
  const changeSchedule = (time: string, p: Policy, s: Schedule, to: Schedule["status"], reason: string): void => {
    emit(time, "DeferralStatusChanged", "DEFERRAL_SCHEDULE", s.scheduleId, p.c.agentId, { scheduleId: s.scheduleId, from: s.status, to, reason });
    s.status = to;
  };
  const statementNumbers = (agentId: string, m: Month) => {
    const st = agents.get(agentId)!;
    const base = sum([m.gross, m.clawbackOffset]);
    const open = sum(st.receivables.filter((r) => r.status !== "CLOSED").map((r) => r.remaining));
    const receivableOffset = base > 0 ? Math.min(base, open) : 0;
    const payable = base > 0 ? base - receivableOffset : 0;
    const carriedReceivable = base < 0 ? -base : 0;
    const withholdingTax = mulFloor(payable, WITHHOLDING_RATE);
    return { base, receivableOffset, carriedReceivable, payable, withholdingTax, net: payable - withholdingTax };
  };

  // 부트스트랩: 설계사 스냅샷
  today = CONTRACT_FROM;
  for (const a of AGENTS) {
    emit(CLOCK.snapshot, "AgentSnapshot", "AGENT", a.agentId, a.agentId, {
      agentId: a.agentId,
      name: a.name,
      grade: a.grade,
      orgPath: a.orgPath,
      status: "ACTIVE",
      validFrom: CONTRACT_FROM,
    });
  }

  const end = worldEndDate();
  for (today = CONTRACT_FROM; today <= end; today = addDays(today, 1)) {
    const ym = ymOf(today);
    const day = Number(today.slice(8, 10));
    const linesAllowed = ym <= HORIZON_YM;

    // 02:10 잠정 명세(전날 라인이 생긴 열린 달)
    for (const a of AGENTS) {
      const st = agents.get(a.agentId)!;
      for (const mYm of [...st.pendingEstimates].sort()) {
        const m = month(a.agentId, mYm);
        if (m.closed) continue;
        const n = statementNumbers(a.agentId, m);
        emit(CLOCK.estimate, "StatementEstimated", "STATEMENT", `${a.agentId}:${mYm}`, a.agentId, {
          agentId: a.agentId,
          closeYm: mYm,
          gross: m.gross,
          clawbackOffset: m.clawbackOffset,
          adjustment: m.adjustment,
          withholdingTax: n.withholdingTax,
          net: n.net,
          basisSeq: st.lastSeq,
          asOf: at(today, CLOCK.estimate),
          receivableOffset: n.receivableOffset,
          carriedReceivable: n.carriedReceivable,
          payable: n.payable,
        });
      }
      st.pendingEstimates.clear();
    }

    // 03:00 분급 도래(매월 1일)
    if (day === 1 && linesAllowed) {
      for (const p of policies) {
        for (const s of p.schedules) {
          if (s.dueYm !== ym || s.status !== "SCHEDULED") continue;
          if (p.status === "INFORCE") {
            addLine(CLOCK.deferralRelease, p, "DEFERRED", s.amount, { basis: { ruleVersionIds: [`DEFERRAL_CURVE:curveId=${CURVE.id}:scheduleId=${s.scheduleId}`] } });
            changeSchedule(CLOCK.deferralRelease, p, s, "RELEASED", "DUE_RELEASED");
          } else if (p.status === "LAPSED") {
            changeSchedule(CLOCK.deferralRelease, p, s, "HELD", "POLICY_NOT_INFORCE");
          }
        }
      }
    }

    // 09:00 체결
    for (const p of byContractDate.get(today) ?? []) {
      const c = p.c;
      const payout = PAYOUT_RATE[p.grade]!;
      const from = ruleFrom(today);
      if (c.contractDate >= LIMIT_FROM) {
        const ledgerId = c.forcedCase === "A1" ? A1_RESERVED.ledgerId : `l-${p.key}`;
        p.ledger = { ledgerId, limit: mulFloor(p.premium, LIMIT_MULTIPLE), accum: 0, postingSeq: 0, fyEnd: fyEndOf(c.contractDate) };
        emit(CLOCK.contract, "LimitLedgerOpened", "LIMIT_LEDGER", ledgerId, c.agentId, {
          ledgerId,
          policyNo: c.policyNo,
          agentId: c.agentId,
          contractDate: c.contractDate,
          fyStart: c.contractDate,
          fyEnd: p.ledger.fyEnd,
          monthlyPremium: p.premium,
          limitMultiple: LIMIT_MULTIPLE,
          limitAmount: p.ledger.limit,
          ruleVersionId: LIMIT_RULE_ID,
        });
      }
      const campaign = CAMPAIGNS.find((x) => x.ym === ym && x.productKey === c.productKey);
      const curve = c.contractDate >= CURVE_FROM;
      const ruleIds = [
        `COMM_RATE:FY_COMM/inst=null:rateId=${p.prod.rateId},v=1`,
        `COMM_TYPE_MST:FY_COMM:from=${from}`,
        `AGENT_PAYOUT_RATE:${p.grade}/FY_COMM:from=${from}`,
        ...(campaign ? [`COMM_TYPE_MST:INCENTIVE:from=${from}`, `AGENT_PAYOUT_RATE:${p.grade}/INCENTIVE:from=${from}`] : []),
        ...(p.ledger ? [`LIMIT_RULE:GA_TO_AGENT:ruleId=${LIMIT_RULE_ID}`] : []),
        ...(curve ? [`DEFERRAL_CURVE:${CURVE.label}:curveId=${CURVE.id}`] : []),
      ];
      let available = p.ledger ? p.ledger.limit - p.ledger.accum : Number.MAX_SAFE_INTEGER;
      const fyRequested = mulFloor(p.premium, p.prod.fyRate, payout);
      const fyCut = Math.max(0, fyRequested - available);
      const fyAfter = fyRequested - fyCut;
      available -= fyAfter;
      const fyPaidNow = curve ? mulFloor(fyAfter, CURVE.firstShare) : fyAfter;
      const fyLine = addLine(CLOCK.contract, p, "FY_COMM", fyPaidNow, {
        limitCutAmt: fyCut,
        limitCutPolicy: fyCut > 0 ? p.prod.cutPolicy : undefined,
        basis: { rate: p.prod.fyRate, payoutRate: payout, ruleVersionIds: ruleIds },
      });
      let incLine: Line | null = null;
      let incAfter = 0;
      if (campaign) {
        p.hasIncentive = true;
        const incRequested = mulFloor(campaign.amount, "1");
        const incCut = Math.max(0, incRequested - available);
        incAfter = incRequested - incCut;
        incLine = addLine(CLOCK.contract, p, "INCENTIVE", incAfter, {
          limitCutAmt: incCut,
          limitCutPolicy: incCut > 0 ? p.prod.cutPolicy : undefined,
          basis: { rate: "1", ruleVersionIds: ruleIds },
        });
      }
      post(CLOCK.contract, p, fyLine, fyAfter);
      if (incLine) post(CLOCK.contract, p, incLine, incAfter);
      if (curve) {
        const share = mulFloor(fyAfter, CURVE.installmentShare);
        CURVE.installments.forEach((months, i) => {
          const amount = i < CURVE.installments.length - 1 ? share : fyAfter - fyPaidNow - share * (CURVE.installments.length - 1);
          const s: Schedule = { scheduleId: `s-${p.key}-${i + 1}`, sourceCalcId: fyLine.calcId, dueYm: addMonths(ymOf(c.contractDate), months), amount, status: "SCHEDULED" };
          p.schedules.push(s);
          emit(CLOCK.contract, "DeferralScheduled", "DEFERRAL_SCHEDULE", s.scheduleId, c.agentId, {
            scheduleId: s.scheduleId,
            sourceCalcId: s.sourceCalcId,
            agentId: c.agentId,
            policyNo: c.policyNo,
            dueYm: s.dueYm,
            amount: s.amount,
            payCondition: PAY_CONDITION,
            curveVersionId: CURVE.id,
            reason: "CURVE",
          });
        });
      }
    }

    // 09:30 계약 이벤트(해약·철회·실효·부활·감액)
    for (const { p, event } of byEventDate.get(today) ?? []) {
      const c = p.c;
      const from = ruleFrom(today);
      emit(CLOCK.policyEvent, "PolicyEventObserved", "POLICY", c.policyNo, c.agentId, { policyNo: c.policyNo, agentId: c.agentId, eventType: event, occurredOn: today });
      if (event === "CANCEL") {
        const installmentNo = monthsBetween(ymOf(c.contractDate), ym) + 1;
        const rate = clawbackRate(installmentNo);
        const paidBase = sum(p.lines.filter((l) => ["FY_COMM", "INCENTIVE", "DEFERRED"].includes(l.commType) && !l.reversed).map((l) => l.amount));
        if (rate && paidBase > 0 && linesAllowed) {
          const amount = -mulFloor(paidBase, rate);
          const line = addLine(CLOCK.policyEvent, p, "CLAWBACK", amount, {
            basis: {
              rate,
              installmentNo,
              ruleVersionIds: [
                `CLAWBACK_RULE:공통/CANCEL:from=${from}`,
                `COMM_TYPE_MST:FY_COMM:from=${from}`,
                ...(p.hasIncentive ? [`COMM_TYPE_MST:INCENTIVE:from=${from}`] : []),
                `COMM_TYPE_MST:CLAWBACK:from=${from}`,
                ...(p.ledger ? [`LIMIT_RULE:GA_TO_AGENT:ruleId=${LIMIT_RULE_ID}`] : []),
              ],
            },
          });
          if (p.ledger && today <= p.ledger.fyEnd) post(CLOCK.policyEvent, p, line, amount);
        }
        for (const s of p.schedules) if (s.status === "SCHEDULED" || s.status === "HELD") changeSchedule(CLOCK.policyEvent, p, s, "CANCELLED", "POLICY_TERMINATED");
        p.status = "ENDED";
      } else if (event === "WITHDRAW") {
        for (const orig of p.lines.filter((l) => !l.reversed && l.amount !== 0)) {
          orig.reversed = true;
          const rev = addLine(CLOCK.policyEvent, p, orig.commType, -orig.amount, { reversalOf: orig.calcId, basis: orig.basis });
          rev.reversed = true;
          if (orig.posted !== 0) post(CLOCK.policyEvent, p, rev, -orig.posted);
        }
        for (const s of p.schedules) if (s.status === "SCHEDULED" || s.status === "HELD") changeSchedule(CLOCK.policyEvent, p, s, "CANCELLED", "SOURCE_REVERSED");
        p.status = "ENDED";
      } else if (event === "LAPSE") {
        p.status = "LAPSED";
      } else if (event === "REINSTATE") {
        p.status = "INFORCE";
      } else if (event === "REDUCE") {
        const newPremium = floorTo(mulFloor(p.premium, REDUCE_SHARE), 1000);
        p.premium = newPremium;
        if (p.ledger && today <= p.ledger.fyEnd) {
          const oldLimit = p.ledger.limit;
          p.ledger.limit = mulFloor(newPremium, LIMIT_MULTIPLE);
          const payload: Record<string, unknown> = { ledgerId: p.ledger.ledgerId };
          if (p.ledger.postingSeq > 0) payload.postingSeq = p.ledger.postingSeq;
          Object.assign(payload, { oldLimit, newLimit: p.ledger.limit, monthlyPremium: newPremium, reason: REBASE_REASON });
          emit(CLOCK.policyEvent, "LimitLedgerRebased", "LIMIT_LEDGER", p.ledger.ledgerId, c.agentId, payload);
        }
      }
    }

    // 10:00 지급(매월 10일, 지난달 마감분)
    if (day === CLOCK.payoutDay) {
      const prev = addMonths(ym, -1);
      for (const a of AGENTS) {
        const m = agents.get(a.agentId)!.months.get(prev);
        if (!m?.payout) continue;
        emit(CLOCK.payout, "PayoutCompleted", "PAYOUT", `${a.agentId}:${prev}`, a.agentId, { ...m.payout, paidAt: at(today, CLOCK.payout) } as Record<string, unknown>);
      }
    }

    // 10:30 유지 수수료(매월 25일, 13회차부터)
    if (day === CLOCK.renewalDay && linesAllowed) {
      for (const p of policies) {
        if (p.status !== "INFORCE") continue;
        const installmentNo = monthsBetween(ymOf(p.c.contractDate), ym) + 1;
        if (installmentNo < 13) continue;
        const from = ruleFrom(today);
        const payout = PAYOUT_RATE[p.grade]!;
        addLine(CLOCK.renewal, p, "RENEWAL", mulFloor(p.premium, p.prod.renewalRate, payout), {
          basis: {
            rate: p.prod.renewalRate,
            payoutRate: payout,
            installmentNo,
            ruleVersionIds: [`COMM_RATE:RENEWAL/inst=13+:rateId=${p.prod.rateId + 1000},v=1`, `COMM_TYPE_MST:RENEWAL:from=${from}`, `AGENT_PAYOUT_RATE:${p.grade}/RENEWAL:from=${from}`],
          },
        });
      }
    }

    // 11:00 마감 후 정정(매월 20일, ADJUSTMENT 필수 케이스 — 대상 라인의 달이 마감된 뒤 한 번)
    if (day === CLOCK.adjustmentDay && linesAllowed) {
      for (const p of policies) {
        if (p.c.forcedCase !== "ADJUSTMENT" || p.adjusted) continue;
        const target = p.lines.find((l) => l.commType === "FY_COMM");
        if (!target || !month(p.c.agentId, target.closeYm).closed) continue;
        const m = month(p.c.agentId, ym);
        if (m.closed) throw new Error(`마감월 ${ym}에 정정`);
        const adjId = `a-${p.key}-1`;
        const amount = -mulFloor(target.amount, ADJUSTMENT_RATE);
        emit(CLOCK.adjustment, "AdjustmentPosted", "ADJUSTMENT", adjId, p.c.agentId, {
          adjId,
          targetCalcId: target.calcId,
          agentId: p.c.agentId,
          amount,
          closeYm: ym,
          reason: ADJUSTMENT_REASON,
        });
        m.adjustment = sum([m.adjustment, amount]);
        agents.get(p.c.agentId)!.pendingEstimates.add(ym);
        p.adjusted = true;
      }
    }

    // 18:00 마감(매월 5일, 지난달)
    if (day === CLOCK.closeDay) {
      const prev = addMonths(ym, -1);
      for (const a of AGENTS) {
        const st = agents.get(a.agentId)!;
        const m = st.months.get(prev);
        if (!m || m.closed) continue;
        const n = statementNumbers(a.agentId, m);
        emit(CLOCK.close, "StatementConfirmed", "STATEMENT", `${a.agentId}:${prev}`, a.agentId, {
          agentId: a.agentId,
          closeYm: prev,
          gross: m.gross,
          clawbackOffset: m.clawbackOffset,
          adjustment: m.adjustment,
          closedAt: at(today, CLOCK.close),
        });
        m.closed = true;
        let left = n.receivableOffset;
        for (const r of st.receivables) {
          if (left === 0) break;
          if (r.status === "CLOSED") continue;
          const take = Math.min(left, r.remaining);
          left -= take;
          r.remaining -= take;
          r.status = r.remaining === 0 ? "CLOSED" : "OFFSET";
          emit(CLOCK.close, "ClawbackReceivableUpdated", "CLAWBACK_RECEIVABLE", r.receivableId, a.agentId, {
            receivableId: r.receivableId,
            agentId: a.agentId,
            originCalcId: r.originCalcId,
            amount: r.amount,
            remaining: r.remaining,
            status: r.status,
          });
        }
        if (n.carriedReceivable > 0) {
          st.receivableSeq++;
          const r: Receivable = {
            receivableId: `r-${agentKey(a.agentId)}-${st.receivableSeq}`,
            originCalcId: m.clawbackCalcIds[0] ?? m.negativeCalcIds[0]!,
            amount: n.carriedReceivable,
            remaining: n.carriedReceivable,
            status: "OPEN",
          };
          st.receivables.push(r);
          emit(CLOCK.close, "ClawbackReceivableUpdated", "CLAWBACK_RECEIVABLE", r.receivableId, a.agentId, {
            receivableId: r.receivableId,
            agentId: a.agentId,
            originCalcId: r.originCalcId,
            amount: r.amount,
            remaining: r.remaining,
            status: r.status,
          });
        }
        if (m.gross !== 0 || m.clawbackOffset !== 0) {
          // paidAt은 지급일에 채운다. 키 순서는 상위 A-1 seq 7과 같다.
          m.payout = {
            agentId: a.agentId,
            closeYm: prev,
            paidAt: "",
            paidAmount: n.net,
            runSeq: 1,
            gross: m.gross,
            clawbackOffset: m.clawbackOffset,
            receivableOffset: n.receivableOffset,
            carriedReceivable: n.carriedReceivable,
            payable: n.payable,
            withholdingTax: n.withholdingTax,
            net: n.net,
          };
        }
      }
    }
  }
  return events;
}

export function toJsonl(events: readonly Envelope[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export const OUT_DIR = join(import.meta.dirname, "../out");

function main(): void {
  const plan = JSON.parse(readFileSync(join(OUT_DIR, "plan.json"), "utf8")) as Plan;
  const events = expand(plan);
  const jsonl = toJsonl(events);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "stream.jsonl"), jsonl);
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const meta = { sha256: sha256(jsonl), eventCount: events.length, planSha256: sha256(readFileSync(join(OUT_DIR, "plan.json"), "utf8")), counts };
  writeFileSync(join(OUT_DIR, "stream.meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`stream: ${events.length}건 sha256=${meta.sha256} → gen/out/stream.jsonl`);
}

if (import.meta.main) main();
