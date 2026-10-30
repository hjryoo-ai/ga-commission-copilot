import { describe, expect, it } from "vitest";
import { A1_RESERVED } from "../world/forced.ts";
import { type Envelope, expand, sha256, toJsonl } from "../world/expand.ts";
import { a1GoldenProblems } from "../world/golden.ts";
import { buildPlan } from "../world/plan.ts";
import { errorsOf, SCHEMA_IDS, validator } from "../world/schemas.ts";

// Phase 1 항목 3: 플랜 → 이벤트 스트림 결정론 전개.
const { plan } = await buildPlan("stub");
const events = expand(plan);
const jsonl = toJsonl(events);
const of = (type: string) => events.filter((e) => e.type === type);
const p = (e: Envelope) => e.payload as Record<string, any>;

describe("결정론", () => {
  it("같은 플랜 → 바이트 동일 스트림(해시)", () => {
    expect(sha256(toJsonl(expand(plan)))).toBe(sha256(jsonl));
  });

  it("seq는 1부터 갭 없이 단조 증가, eventId 유일·UUIDv7 모양, occurredAt 비감소", () => {
    events.forEach((e, i) => expect(e.seq).toBe(i + 1));
    expect(new Set(events.map((e) => e.eventId)).size).toBe(events.length);
    for (const e of events) expect(e.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    for (let i = 1; i < events.length; i++) expect(Date.parse(events[i]!.occurredAt)).toBeGreaterThanOrEqual(Date.parse(events[i - 1]!.occurredAt));
  });
});

describe("생성 ID에 증권번호가 없다(설계서 v0.1.13 §4.1(a))", () => {
  // payload의 *Id 필드(원장·라인·스케줄·조정·채권과 그 참조) — policyNo 필드 자체는 엔진 이벤트 사실이라 제외
  const ids = events.flatMap((e) => Object.entries(p(e)).filter(([k, v]) => /Id$/.test(k) && typeof v === "string").map(([k, v]) => [k, v as string] as const));
  const RESERVED = new Set(["1", "2", "6"]);

  it("어떤 ID 값에도 POL-\\d{4}-\\d{4,5} 패턴이 없다", () => {
    expect(ids.length).toBeGreaterThan(1000);
    expect(ids.filter(([, v]) => /POL-\d{4}-\d{4,5}/.test(v))).toEqual([]);
  });

  it("ID 모양: 예약 ID(A-1) 아니면 <종류>-<설계사 키>[-<계약 순번>]-<일련> 또는 l-<계약 키>", () => {
    const shape: Record<string, RegExp> = {
      calcId: /^c-A\d{4}-\d{2,}-\d+$/,
      sourceCalcId: /^c-A\d{4}-\d{2,}-\d+$/,
      targetCalcId: /^c-A\d{4}-\d{2,}-\d+$/,
      originCalcId: /^c-A\d{4}-\d{2,}-\d+$/,
      reversalOfCalcId: /^c-A\d{4}-\d{2,}-\d+$/,
      ledgerId: /^l-A\d{4}-\d{2,}$/,
      scheduleId: /^s-A\d{4}-\d{2,}-\d+$/,
      adjId: /^a-A\d{4}-\d{2,}-\d+$/,
      receivableId: /^r-A\d{4}-\d+$/,
    };
    const bad = ids.filter(([k, v]) => !RESERVED.has(v) && shape[k] && !shape[k]!.test(v));
    expect(bad.slice(0, 5)).toEqual([]);
    // 같은 계약의 원장·라인은 같은 계약 키
    const a3 = of("LimitLedgerOpened").find((e) => p(e).policyNo === "POL-2026-0004")!;
    expect(p(a3).ledgerId).toBe("l-A1003-16");
    expect(of("CommissionCalculated").filter((e) => p(e).policyNo === "POL-2026-0004").every((e) => String(p(e).calcId).startsWith("c-A1003-16-"))).toBe(true);
  });
});

describe("G1: 모든 이벤트가 상위 봉투 스키마를 통과", () => {
  it(`${events.length}건`, () => {
    const v = validator(SCHEMA_IDS.envelope);
    const valid = (e: Envelope): boolean => v(e) === true;
    const bad = events.filter((e) => !valid(e)).slice(0, 3).map((e) => `${e.seq} ${e.type}: ${(valid(e), errorsOf(v))}`);
    expect(bad).toEqual([]);
  });

  it("D1 적재 기준(earnings_line > 5000) — 라인 = CommissionCalculated + AdjustmentPosted", () => {
    expect(of("CommissionCalculated").length + of("AdjustmentPosted").length).toBeGreaterThan(5000);
  });
});

describe("골든: A-1 계약은 상위 샘플 스트림과 payload 필드 단위로 동등(§4.1(a))", () => {
  it("11건 동등·순서 일치", () => {
    expect(a1GoldenProblems(events)).toEqual([]);
  });

  it("예약 ID는 A-1 계약만 쓴다", () => {
    const calc = of("CommissionCalculated").filter((e) => (A1_RESERVED.calcIds as readonly string[]).includes(p(e).calcId));
    expect(calc.map((e) => p(e).policyNo)).toEqual([A1_RESERVED.policyNo, A1_RESERVED.policyNo, A1_RESERVED.policyNo]);
    const ledgers = of("LimitLedgerOpened").filter((e) => p(e).ledgerId === A1_RESERVED.ledgerId || p(e).policyNo === A1_RESERVED.policyNo);
    expect(ledgers.map((e) => [p(e).ledgerId, p(e).policyNo])).toEqual([[A1_RESERVED.ledgerId, A1_RESERVED.policyNo]]);
  });
});

describe("필수 케이스가 스트림에 있다(상위 부록 B)", () => {
  const ledgers = new Map<string, { limit: number; accum: number; maxPct: number }>();
  for (const e of events) {
    if (e.type === "LimitLedgerOpened") ledgers.set(p(e).ledgerId, { limit: p(e).limitAmount, accum: 0, maxPct: 0 });
    if (e.type === "LimitLedgerPosted") {
      const l = ledgers.get(p(e).ledgerId)!;
      l.accum = p(e).accumAfter;
      l.maxPct = Math.max(l.maxPct, Math.floor((l.accum * 100) / l.limit));
    }
  }
  const pcts = [...ledgers.values()].map((l) => l.maxPct);

  it("한도 80%대·95%대·100% 각 1건 이상", () => {
    expect(pcts.some((x) => x >= 80 && x < 95)).toBe(true);
    expect(pcts.some((x) => x >= 95 && x < 100)).toBe(true);
    expect(pcts.some((x) => x === 100)).toBe(true);
  });

  it("삭감(CUT)·이연 정책(DEFER_AFTER_FY) 라인 각 1건 이상", () => {
    const policies = of("CommissionCalculated").map((e) => p(e).limitCutPolicy);
    expect(policies).toContain("CUT");
    expect(policies).toContain("DEFER_AFTER_FY");
  });

  it("재산정(newLimit < 누적) 1건 이상", () => {
    // A-3: 누적 1,260,000(FY) > 새 한도 1,200,000
    const a3 = of("LimitLedgerRebased").filter((e) => p(e).ledgerId === "l-A1003-16");
    expect(a3.map((e) => [p(e).oldLimit, p(e).newLimit])).toEqual([[2_400_000, 1_200_000]]);
    expect(ledgers.get("l-A1003-16")!.accum).toBe(1_260_000);
  });

  it("HELD 분급·RELEASED 분급 각 1건 이상", () => {
    const to = of("DeferralStatusChanged").map((e) => p(e).to);
    expect(to).toContain("HELD");
    expect(to).toContain("RELEASED");
  });

  it("환수 채권 이월(OPEN) 뒤 상계(OFFSET 또는 CLOSED)", () => {
    const r = of("ClawbackReceivableUpdated").filter((e) => p(e).agentId === "A-1007");
    expect(r[0] && p(r[0]).status).toBe("OPEN");
    expect(r.some((e) => ["OFFSET", "CLOSED"].includes(p(e).status))).toBe(true);
  });

  it("취소·재분개 짝(reversalOfCalcId)과 마감 후 정정(ADJUSTMENT)", () => {
    expect(of("CommissionCalculated").some((e) => p(e).policyNo === "POL-2026-0010" && p(e).reversalOfCalcId)).toBe(true);
    expect(of("AdjustmentPosted").map((e) => [p(e).agentId, p(e).closeYm])).toEqual([["A-1009", "202701"]]);
  });

  it("한도 경계 직전 계약(2026-06-30)은 원장이 없다", () => {
    expect(of("LimitLedgerOpened").some((e) => p(e).policyNo === "POL-2026-0012")).toBe(false);
  });
});

describe("상위 §5 불변식 사전 점검(정본 검사는 projection-java G2)", () => {
  it("확정 월 합계 = Σ 라인, 마감 뒤 그 달 라인·예상 없음", () => {
    const sums = new Map<string, { gross: number; clawbackOffset: number; adjustment: number }>();
    const closed = new Set<string>();
    const problems: string[] = [];
    for (const e of events) {
      const k = `${p(e).agentId}:${p(e).closeYm}`;
      const s = sums.get(k) ?? { gross: 0, clawbackOffset: 0, adjustment: 0 };
      if (e.type === "CommissionCalculated" || e.type === "AdjustmentPosted" || e.type === "StatementEstimated") {
        if (closed.has(k)) problems.push(`${e.seq} ${e.type}: 마감월 ${k}`);
      }
      if (e.type === "CommissionCalculated") {
        if (p(e).commType === "CLAWBACK") s.clawbackOffset += p(e).amount;
        else s.gross += p(e).amount;
      }
      if (e.type === "AdjustmentPosted") s.adjustment += p(e).amount;
      sums.set(k, s);
      if (e.type === "StatementConfirmed") {
        closed.add(k);
        const want = { gross: p(e).gross, clawbackOffset: p(e).clawbackOffset, adjustment: p(e).adjustment };
        if (JSON.stringify(want) !== JSON.stringify(s)) problems.push(`${e.seq} ${k}: 확정 ${JSON.stringify(want)} ≠ Σ ${JSON.stringify(s)}`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });

  it("원장: 순번 +1, accumAfter − 직전 = amount, 양수 전기 뒤 ≤ 한도, 누적 ≥ 0", () => {
    const state = new Map<string, { limit: number; accum: number; seq: number }>();
    const problems: string[] = [];
    for (const e of events) {
      const q = p(e);
      if (e.type === "LimitLedgerOpened") state.set(q.ledgerId, { limit: q.limitAmount, accum: 0, seq: 0 });
      if (e.type === "LimitLedgerRebased") {
        const l = state.get(q.ledgerId)!;
        if (q.oldLimit !== l.limit) problems.push(`${e.seq}: oldLimit`);
        l.limit = q.newLimit;
      }
      if (e.type === "LimitLedgerPosted") {
        const l = state.get(q.ledgerId)!;
        if (q.postingSeq !== l.seq + 1) problems.push(`${e.seq}: postingSeq`);
        if (q.accumAfter - l.accum !== q.amount) problems.push(`${e.seq}: accum 차이`);
        if (q.amount > 0 && q.accumAfter > l.limit) problems.push(`${e.seq}: 한도 초과`);
        if (q.accumAfter < 0) problems.push(`${e.seq}: 음수 누적`);
        l.accum = q.accumAfter;
        l.seq = q.postingSeq;
      }
    }
    expect(problems).toEqual([]);
  });

  it("분급 전이는 SCHEDULED→RELEASED·HELD·CANCELLED, HELD→CANCELLED뿐(DD-9)", () => {
    const allowed = new Set(["SCHEDULED>RELEASED>DUE_RELEASED", "SCHEDULED>HELD>POLICY_NOT_INFORCE", "SCHEDULED>CANCELLED>POLICY_TERMINATED", "SCHEDULED>CANCELLED>SOURCE_REVERSED", "HELD>CANCELLED>POLICY_TERMINATED", "HELD>CANCELLED>SOURCE_REVERSED"]);
    const status = new Map<string, string>();
    const problems: string[] = [];
    for (const e of events) {
      if (e.type === "DeferralScheduled") status.set(p(e).scheduleId, "SCHEDULED");
      if (e.type === "DeferralStatusChanged") {
        const k = `${p(e).from}>${p(e).to}>${p(e).reason}`;
        if (!allowed.has(k) || status.get(p(e).scheduleId) !== p(e).from) problems.push(`${e.seq}: ${k}`);
        status.set(p(e).scheduleId, p(e).to);
      }
    }
    expect(problems).toEqual([]);
  });
});
