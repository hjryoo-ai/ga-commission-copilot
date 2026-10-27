// 날짜·월 계산(UTC 기준 순수 달력 연산, 시각 문자열은 +09:00 고정).

export const OFFSET = "+09:00";

export function ymOf(date: string): string {
  return date.slice(0, 4) + date.slice(5, 7);
}

export function addMonths(ym: string, n: number): string {
  const total = Number(ym.slice(0, 4)) * 12 + (Number(ym.slice(4, 6)) - 1) + n;
  return `${Math.floor(total / 12)}`.padStart(4, "0") + `${(total % 12) + 1}`.padStart(2, "0");
}

export function monthsBetween(fromYm: string, toYm: string): number {
  const a = Number(fromYm.slice(0, 4)) * 12 + Number(fromYm.slice(4, 6));
  const b = Number(toYm.slice(0, 4)) * 12 + Number(toYm.slice(4, 6));
  return b - a;
}

export function lastDay(ym: string): number {
  return new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(4, 6)), 0)).getUTCDate();
}

export function dateIn(ym: string, day: number): string {
  return `${ym.slice(0, 4)}-${ym.slice(4, 6)}-${String(day).padStart(2, "0")}`;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 계약일 + 1년 − 1일(상위 A-1: 2026-08-01 → 2027-07-31). */
export function fyEndOf(contractDate: string): string {
  const y = Number(contractDate.slice(0, 4)) + 1;
  return addDays(`${y}${contractDate.slice(4)}`, -1);
}

export function at(date: string, time: string): string {
  return `${date}T${time}${OFFSET}`;
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}
