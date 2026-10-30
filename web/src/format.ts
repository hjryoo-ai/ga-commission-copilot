// 표시 형식만(상위 §7: 통화 포맷은 프론트 담당). 금액을 계산·비교하지 않는다.

const WON = new Intl.NumberFormat("ko-KR");

/** 정수 원 → "1,800,000원"(음수는 "-"). */
export const won = (n: number) => `${WON.format(n)}원`;

/** yyyyMM → "2026년 8월". */
export const ym = (s: string) => `${s.slice(0, 4)}년 ${Number(s.slice(4, 6))}월`;

const KST = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit" });
const KST_DATE = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });

/** ISO 시각 → KST "MM-DD"(기준 데이터 칩). */
export function mmdd(iso: string): string {
  const parts = Object.fromEntries(KST.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.month}-${parts.day}`;
}

/** ISO 시각 → KST "YYYY-MM-DD". */
export const kstDate = (iso: string) => KST_DATE.format(new Date(iso));

/** 화면 월 목록 범위: 마지막 달에서 거슬러 최대 36개월(상위 §7 범위 상한) — 달 순번이지 금액이 아니다. */
export function monthWindow(from: string, to: string): { from: string; to: string } {
  const idx = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(4, 6)) - 1;
  const start = Math.max(idx(from), idx(to) - 35);
  return { from: `${Math.floor(start / 12)}${String((start % 12) + 1).padStart(2, "0")}`, to };
}
