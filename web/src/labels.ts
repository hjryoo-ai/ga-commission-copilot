// 화면 라벨(상위 설계서 v1.9 §6.2 상태 매핑·세후 16칸, §6.3 한도 문구). 표만 둔다 — 금액은 바꾸지 않는다.
import type { DeferralStatus, MonthStatus, NetBasis, Stage } from "./api";

/** 월 상태 → 라벨(세전·환수 상계·라인 금액). */
export const MONTH_STATUS_LABEL: Record<MonthStatus, string> = {
  PROVISIONAL: "예상",
  ESTIMATED: "예상",
  CONFIRMED: "확정",
  PAID: "지급완료",
};

/** 정정 금액은 어느 달이든(상위 §6.2 v1.7.1). */
export const ADJUSTMENT_LABEL = "지급 반영 미정";
export const LEDGER_LABEL = "원장 기준";
export const CONTRACT_LABEL = "계약 정보";

/** 세전 라벨 — CONFIRMED이고 세후가 예상 값이면 "확정(세후 예상)". */
export function grossLabel(status: MonthStatus, netBasis: NetBasis | undefined): string {
  return status === "CONFIRMED" && netBasis === "ESTIMATE" ? "확정(세후 예상)" : MONTH_STATUS_LABEL[status];
}

export type NetCell = { show: true; label: string; note?: "estimateAsOf" | "paidAt" } | { show: false; note: string };

/** 세후(실수령) 16칸 = 월 상태 4 × netBasis(3 + 없음). 표에 없는 10칸은 숨김 "세후 정보 없음"(보이지 않는 쪽으로 실패). */
export function netCell(status: MonthStatus, netBasis: NetBasis | undefined): NetCell {
  if (status === "PROVISIONAL" && netBasis === undefined) return { show: false, note: "세후는 야간 산출 후 표시" };
  if (status === "ESTIMATED" && netBasis === "ESTIMATE") return { show: true, label: "예상", note: "estimateAsOf" };
  if (status === "CONFIRMED" && netBasis === "ESTIMATE") return { show: true, label: "예상" };
  if (status === "CONFIRMED" && netBasis === undefined) return { show: false, note: "세후는 지급 시 확정" };
  if (status === "CONFIRMED" && netBasis === "CONFIRM") return { show: true, label: "확정" };
  if (status === "PAID" && netBasis === "PAYOUT") return { show: true, label: "지급완료", note: "paidAt" };
  return { show: false, note: "세후 정보 없음" };
}

/** 라인 금액 라벨: 정정은 "지급 반영 미정", 나머지는 그 달 상태. */
export function lineLabel(commType: string, status: MonthStatus): string {
  return commType === "ADJUSTMENT" ? ADJUSTMENT_LABEL : MONTH_STATUS_LABEL[status];
}

export const DEFERRAL_LABEL: Record<DeferralStatus, string> = {
  SCHEDULED: "예정",
  RELEASED: "이번 달 지급 대상",
  HELD: "보류",
  CANCELLED: "취소",
};

/** 환수 채권 상태(그 항목의 상태 — 상위 §6.2 "분급·채권 금액은 그 항목의 상태"). */
export const RECEIVABLE_LABEL: Record<string, string> = { OPEN: "이월", OFFSET: "상계", CLOSED: "종결", WRITTEN_OFF: "상각" };

export const STAGE_LABEL: Record<Stage, string> = { OK: "정상", WARN: "주의", CRIT: "임박", FULL: "소진" };

export const FLAG_LABEL: Record<string, string> = { CANCELLED: "해약", LAPSED: "실효", OVERDUE: "납입 지연", REDUCED: "감액" };

export const COMM_TYPE_LABEL: Record<string, string> = {
  FY_COMM: "초년도 수수료",
  RENEWAL: "유지 수수료",
  INCENTIVE: "시책",
  OVERRIDE: "관리 수수료",
  DEFERRED: "분급",
  CLAWBACK: "환수",
  ADJUSTMENT: "정정",
};

export const commTypeLabel = (t: string) => COMM_TYPE_LABEL[t] ?? t;

/** 한도 삭감 문구(상위 §6.3 v1.7): 정책 이름이 아니라 사실대로. */
export const CUT_LABEL = "한도 초과 삭감";
export const DEFER_NOTE = "(사규: 초년도 후 이연 — 현재 이연 스케줄 없음)";
