// 가상 요율표·규칙(설계서 §4.1(a)-2, 부록 B.3, 상위 설계서 v1.9 부록 A-1 엔진 시드). 전부 가상 예시값.
// 이 디렉터리는 데모 세계의 "엔진 대역"이다 — 금액은 여기서만 결정론으로 계산하고 LLM은 금액을 만들지 않는다(대전제 1).
// 상위 A-1 정본 스트림(contracts/events/v1/samples/a1/a1_portal_150000_e2.jsonl)과 payload가 같게 나오도록 시드 값을 맞췄다.

export const TENANT = "T1";

/** 세계 시간 범위. 체결일 2025-07 ~ 2027-06(상위 부록 B), 라인은 HORIZON_YM까지, 마지막 마감·지급까지 이벤트를 낸다. */
export const CONTRACT_FROM = "2025-07-01";
export const CONTRACT_TO = "2027-06-30";
export const HORIZON_YM = "202806";

/** 상위 부록 B 경계: 2026-07-01부터 한도(1200%룰) 적용, 2027-01-01부터 분급 적용. */
export const LIMIT_FROM = "2026-07-01";
export const CURVE_FROM = "2027-01-01";

export type CutPolicy = "CUT" | "DEFER_AFTER_FY";

export interface Product {
  key: string;
  rateId: number;
  /** 초년도 수수료 요율(월납 배수, decimalString) */
  fyRate: string;
  /** 13회차부터 월 유지 수수료 요율(월납 배수) */
  renewalRate: string;
  premiumMin: number;
  premiumMax: number;
  cutPolicy: CutPolicy;
}

export const PRODUCTS: readonly Product[] = [
  { key: "WHOLE-LIFE-20Y", rateId: 1001, fyRate: "7", renewalRate: "0.05", premiumMin: 50_000, premiumMax: 500_000, cutPolicy: "DEFER_AFTER_FY" },
  { key: "TERM-10Y", rateId: 1002, fyRate: "5", renewalRate: "0.03", premiumMin: 30_000, premiumMax: 200_000, cutPolicy: "CUT" },
  { key: "HEALTH-100", rateId: 1003, fyRate: "6", renewalRate: "0.04", premiumMin: 40_000, premiumMax: 300_000, cutPolicy: "DEFER_AFTER_FY" },
  { key: "ANNUITY-10Y", rateId: 1004, fyRate: "3", renewalRate: "0.02", premiumMin: 100_000, premiumMax: 1_000_000, cutPolicy: "DEFER_AFTER_FY" },
  { key: "CHILD-30Y", rateId: 1005, fyRate: "6.5", renewalRate: "0.04", premiumMin: 30_000, premiumMax: 150_000, cutPolicy: "CUT" },
];

export function product(key: string): Product {
  const p = PRODUCTS.find((x) => x.key === key);
  if (!p) throw new Error(`unknown productKey ${key}`);
  return p;
}

/** 설계사 등급별 지급률(AGENT_PAYOUT_RATE). A-1 설계사는 SR·0.9. */
export const PAYOUT_RATE: Readonly<Record<string, string>> = { SR: "0.9", MR: "0.85", JR: "0.8" };

/** 시책 캠페인: 그 달·그 상품 체결 계약에 정액(요율 "1"). A-1은 202608 WHOLE-LIFE-20Y 1,000,000. */
export const CAMPAIGNS: readonly { ym: string; productKey: string; amount: number }[] = [
  { ym: "202608", productKey: "WHOLE-LIFE-20Y", amount: 1_000_000 },
  { ym: "202611", productKey: "TERM-10Y", amount: 500_000 },
  { ym: "202703", productKey: "HEALTH-100", amount: 800_000 },
];

export const LIMIT_MULTIPLE = "12";
export const LIMIT_RULE_ID = "1";

/** 환수율: 1~6회차 0.7, 7~12회차 0.4, 13회차부터 없음(상위 엔진 시드: 7~12회차 40%, E1 골든 2회차 70%). */
export function clawbackRate(installmentNo: number): string | null {
  if (installmentNo <= 6) return "0.7";
  if (installmentNo <= 12) return "0.4";
  return null;
}

/** 분급 커브 "4년 분급(2027)": 초년도 40% 지급, 12·24·36개월 뒤 20%씩(상위 E2 estimate_cycle_05). */
export const CURVE = { id: "1", label: "4년 분급(2027)", firstShare: "0.4", installments: [12, 24, 36], installmentShare: "0.2" } as const;
export const PAY_CONDITION = "POLICY_INFORCE";

/** 원천세 3.3%(상위 엔진 시드). */
export const WITHHOLDING_RATE = "0.033";

/** 마감 후 정정(ADJUSTMENT 필수 케이스): 대상 라인 금액의 −2.5%, 사유는 엔진 자유 문자열. */
export const ADJUSTMENT_RATE = "0.025";
export const ADJUSTMENT_REASON = "소급 요율 정정";

/** 감액(REDUCE): 월납 50%(천 원 미만 버림). */
export const REDUCE_SHARE = "0.5";
export const REBASE_REASON = "PREMIUM_REDUCED";

/** 시각 규칙(+09:00). 상위 A-1: 계산 09:00, 마감 익월 5일 18:00, 지급 익월 10일 10:00, 해약 15일 09:30, 잠정 명세 다음 날 02:10. */
export const CLOCK = {
  snapshot: "00:00:00",
  estimate: "02:10:00",
  deferralRelease: "03:00:00",
  contract: "09:00:00",
  policyEvent: "09:30:00",
  payout: "10:00:00",
  renewal: "10:30:00",
  adjustment: "11:00:00",
  close: "18:00:00",
  closeDay: 5,
  payoutDay: 10,
  policyEventDay: 15,
  adjustmentDay: 20,
  renewalDay: 25,
} as const;

/** 규칙 버전 문자열의 시행일: 2026년 계산부터 상위 샘플과 같은 from=2026-01-01, 그 전은 2025-01-01. */
export function ruleFrom(calcDate: string): string {
  return calcDate >= "2026-01-01" ? "2026-01-01" : "2025-01-01";
}
