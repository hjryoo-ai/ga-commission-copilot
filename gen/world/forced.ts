// 강제 케이스 16건(설계서 v0.1.6 §4.1(a), 상위 부록 B) = 필수 케이스 12건(FORCED — LLM 앞에 주입) + 경계 4건(BOUNDARIES — LLM 출력 뒤 태깅 또는 주입).
// 금액은 없다 — 아래 주석의 금액은 rules/ 전개 결과(검증은 test/expand.test.ts)이며 이 파일은 계약 입력값만 정한다.
import { addDays } from "./calendar.ts";
import type { PlanContract } from "./plan-types.ts";
import { CURVE_FROM, LIMIT_FROM } from "./rules/tables.ts";

export const FORCED: readonly PlanContract[] = [
  // A-1(상위 v1.9 부록 A-1 정본): 한도 100% FULL, INCENTIVE limitCutAmt 145,000 DEFER_AFTER_FY, 7회차 해약 → 환수 −720,000 채권 이월
  { policyNo: "POL-2026-0001", agentId: "A-1001", productKey: "WHOLE-LIFE-20Y", contractDate: "2026-08-01", monthlyPremium: 150_000, lifecycle: [{ ym: "202702", event: "CANCEL" }], forcedCase: "A1" },
  // A-2 분급: 2027 커브, 202802 첫 도래 RELEASED
  { policyNo: "POL-2027-0002", agentId: "A-1002", productKey: "WHOLE-LIFE-20Y", contractDate: "2027-02-01", monthlyPremium: 200_000, lifecycle: [], forcedCase: "A2_CURVE" },
  // HELD 분급: 202709 실효 → 202801 도래분 HELD(POLICY_NOT_INFORCE)
  { policyNo: "POL-2027-0003", agentId: "A-1002", productKey: "HEALTH-100", contractDate: "2027-01-10", monthlyPremium: 120_000, lifecycle: [{ ym: "202709", event: "LAPSE" }], forcedCase: "DEFERRAL_HELD" },
  // A-3 감액 재산정: 누적 1,260,000 > 새 한도 1,200,000
  { policyNo: "POL-2026-0004", agentId: "A-1003", productKey: "WHOLE-LIFE-20Y", contractDate: "2026-11-02", monthlyPremium: 200_000, lifecycle: [{ ym: "202703", event: "REDUCE" }], forcedCase: "A3_REBASE" },
  // 한도 80%대(85.8%)·95%대(97.5%)
  { policyNo: "POL-2026-0005", agentId: "A-1004", productKey: "WHOLE-LIFE-20Y", contractDate: "2026-08-03", monthlyPremium: 250_000, lifecycle: [], forcedCase: "LIMIT_80" },
  { policyNo: "POL-2026-0006", agentId: "A-1005", productKey: "WHOLE-LIFE-20Y", contractDate: "2026-08-05", monthlyPremium: 185_000, lifecycle: [], forcedCase: "LIMIT_95" },
  // 삭감(CUT): TERM-10Y 202611 시책 500,000 중 125,000 삭감
  { policyNo: "POL-2026-0007", agentId: "A-1006", productKey: "TERM-10Y", contractDate: "2026-11-04", monthlyPremium: 50_000, lifecycle: [], forcedCase: "LIMIT_CUT" },
  // 환수 채권 이월(2회차 해약 70%) → 다음 계약 수수료로 상계
  { policyNo: "POL-2026-0008", agentId: "A-1007", productKey: "HEALTH-100", contractDate: "2026-09-01", monthlyPremium: 200_000, lifecycle: [{ ym: "202610", event: "CANCEL" }], forcedCase: "RECEIVABLE_CANCEL" },
  { policyNo: "POL-2026-0009", agentId: "A-1007", productKey: "WHOLE-LIFE-20Y", contractDate: "2026-12-01", monthlyPremium: 300_000, lifecycle: [], forcedCase: "RECEIVABLE_OFFSET" },
  // 취소·재분개 짝: 청약철회 → 원 라인과 reversalOfCalcId 음수 라인
  { policyNo: "POL-2026-0010", agentId: "A-1008", productKey: "WHOLE-LIFE-20Y", contractDate: "2026-10-06", monthlyPremium: 100_000, lifecycle: [{ ym: "202610", event: "WITHDRAW" }], forcedCase: "REVERSAL_PAIR" },
  // 마감 후 정정: 202612 FY 라인 → 202701 AdjustmentPosted
  { policyNo: "POL-2026-0011", agentId: "A-1009", productKey: "ANNUITY-10Y", contractDate: "2026-12-07", monthlyPremium: 400_000, lifecycle: [], forcedCase: "ADJUSTMENT" },
  // 한도 경계 직전(2026-06-30 체결 — 원장 없음)
  { policyNo: "POL-2026-0012", agentId: "A-1010", productKey: "WHOLE-LIFE-20Y", contractDate: "2026-06-30", monthlyPremium: 150_000, lifecycle: [], forcedCase: "BOUNDARY_PRE_LIMIT" },
];

/**
 * 경계 4건(상위 부록 B "경계 넷"): 한도 시행일·분급 시행일의 전날과 당일 체결. 규칙은 체결일로만 갈린다(expand.ts).
 * 플랜에 그 날짜의 LLM 계약이 이미 있으면 중복 주입하지 않고 그 계약에 forcedCase를 붙인다(태깅). 없을 때만 inject를 넣는다.
 * BOUNDARY_PRE_LIMIT(FORCED, 2026-06-30)와 BOUNDARY_LIMIT_BEFORE는 같은 날짜의 다른 계약이다 — 운영자 지시 "12 → 16"대로 둘 다 둔다.
 */
export interface BoundaryCase {
  forcedCase: string;
  date: string;
  /** 그 날짜 LLM 계약이 없을 때 넣는 계약(policyNo는 필수 케이스와 같은 4자리 체계 — 생성 계약 5자리와 충돌 불가). */
  inject: PlanContract;
}

const boundary = (forcedCase: string, no: number, agentId: string, date: string): BoundaryCase => ({
  forcedCase,
  date,
  inject: { policyNo: `POL-${date.slice(0, 4)}-00${no}`, agentId, productKey: "WHOLE-LIFE-20Y", contractDate: date, monthlyPremium: 150_000, lifecycle: [], forcedCase },
});

export const BOUNDARIES: readonly BoundaryCase[] = [
  boundary("BOUNDARY_LIMIT_BEFORE", 13, "A-1011", addDays(LIMIT_FROM, -1)), // 2026-06-30 원장 없음
  boundary("BOUNDARY_LIMIT_AFTER", 14, "A-1012", LIMIT_FROM), // 2026-07-01 원장 있음
  boundary("BOUNDARY_DEFERRAL_BEFORE", 15, "A-1013", addDays(CURVE_FROM, -1)), // 2026-12-31 커브 분급 없음
  boundary("BOUNDARY_DEFERRAL_AFTER", 16, "A-1014", CURVE_FROM), // 2027-01-01 커브 분급 있음
];

/** 강제 케이스 수(설계서 v0.1.6: 16). */
export const FORCED_CASE_COUNT = FORCED.length + BOUNDARIES.length;

/** 경계 4건 적용. 태깅 대상은 그 날짜 LLM 계약 중 lifecycle이 빈 것 우선, 그다음 policyNo 순 첫 건(결정론). 이미 붙은 경계는 건너뛴다(멱등). */
export function applyBoundaries(contracts: readonly PlanContract[]): PlanContract[] {
  const out = [...contracts];
  for (const b of BOUNDARIES) {
    if (out.some((c) => c.forcedCase === b.forcedCase)) continue;
    const hit = out
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.contractDate === b.date && !c.forcedCase)
      .sort((x, y) => Number(x.c.lifecycle.length > 0) - Number(y.c.lifecycle.length > 0) || x.c.policyNo.localeCompare(y.c.policyNo))[0];
    if (hit) out[hit.i] = { ...hit.c, forcedCase: b.forcedCase };
    else out.push(b.inject);
  }
  return out;
}

/**
 * A-1 계약의 예약 ID(설계서 v0.1.5 §4.1(a)). 상위 샘플 값 그대로이고 다른 계약은 쓸 수 없다 —
 * 생성 계약은 policyNo `POL-<yyyy>-<5자리>`, calcId `c-<policyNo>-<n>`, ledgerId `l-<policyNo>` 접두 체계라 충돌할 수 없다.
 */
export const A1_RESERVED = {
  policyNo: "POL-2026-0001",
  calcIds: ["1", "2", "6"],
  ledgerId: "1",
} as const;
