// 컨텍스트 숫자 집합 S와 컨텍스트 키(설계서 §6.1 1, §4.2 G4·G5).
// 컨텍스트는 JSON 값(객체·배열·문자열·정수)이다. 파생값(DerivedNumbers)은 호출자가 컨텍스트에 미리 넣는다 — 여기서는 계산하지 않는다.
import { canonical, extractTokens, percentOf, type TokenKind } from "./numbers.ts";

export type Json = null | boolean | number | string | readonly Json[] | { readonly [k: string]: Json | undefined };

export interface ContextNumbers {
  numbers: ReadonlySet<string>;
  percents: ReadonlySet<string>;
  dates: ReadonlySet<string>;
  months: ReadonlySet<string>;
  monthDays: ReadonlySet<string>;
  monthOfYears: ReadonlySet<string>;
  years: ReadonlySet<string>;
  days: ReadonlySet<string>;
  policyTails: ReadonlySet<string>;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2})?)?$/;
const YM = /^(\d{4})(0[1-9]|1[0-2])$/;
const DECIMAL = /^-?\d+(?:\.\d+)?$/;
const PERCENT = /^-?(\d+(?:\.\d+)?)%$/;
const MASKED = /^\*+(\d{4})$/;

/** 컨텍스트 값 → 숫자 집합 S. extra는 호출자가 더하는 허용값(예: 툴 결과 밖의 파생값). */
export function contextNumbers(ctx: Json, extra: readonly (number | string)[] = []): ContextNumbers {
  const s = {
    numbers: new Set<string>(),
    percents: new Set<string>(),
    dates: new Set<string>(),
    months: new Set<string>(),
    monthDays: new Set<string>(),
    monthOfYears: new Set<string>(),
    years: new Set<string>(),
    days: new Set<string>(),
    policyTails: new Set<string>(),
  };
  const addMonth = (y: string, m: string) => {
    s.months.add(`${y}${m}`);
    s.monthOfYears.add(String(Number(m)));
    s.years.add(y);
  };
  const addNumber = (v: string) => {
    const c = canonical(v);
    if (c === null) return;
    s.numbers.add(c);
    s.percents.add(c);
    if (v.includes(".")) s.percents.add(percentOf(v)!);
  };
  const leaf = (v: string | number) => {
    if (typeof v === "number") {
      if (Number.isFinite(v)) addNumber(String(v));
      return;
    }
    let m: RegExpExecArray | null;
    if ((m = ISO_DATE.exec(v))) {
      s.dates.add(`${m[1]}-${m[2]}-${m[3]}`);
      s.monthDays.add(`${m[2]}-${m[3]}`);
      s.days.add(String(Number(m[3])));
      addMonth(m[1]!, m[2]!);
    } else if ((m = YM.exec(v))) addMonth(m[1]!, m[2]!);
    else if ((m = PERCENT.exec(v))) s.percents.add(canonical(m[1]!)!);
    else if ((m = MASKED.exec(v))) s.policyTails.add(m[1]!);
    else if (DECIMAL.test(v)) addNumber(v);
  };
  const walk = (v: Json | undefined) => {
    if (v === null || v === undefined || typeof v === "boolean") return;
    if (typeof v === "number" || typeof v === "string") return leaf(v);
    if (Array.isArray(v)) return v.forEach(walk);
    for (const x of Object.values(v)) walk(x);
  };
  walk(ctx);
  extra.forEach(leaf);
  return s;
}

/** 토큰 하나가 S 안에 있는가(설계서 §6.1 3 — 날짜는 월 단위 일치 허용). */
export function grounded(kind: TokenKind, value: string, s: ContextNumbers): boolean {
  switch (kind) {
    case "number":
      return s.numbers.has(value);
    case "percent":
      return s.percents.has(value);
    case "date":
      return s.dates.has(value) || s.months.has(value.slice(0, 4) + value.slice(5, 7));
    case "month":
      return s.months.has(value);
    case "monthDay":
      return s.monthDays.has(value) || s.monthOfYears.has(String(Number(value.slice(0, 2))));
    case "monthOfYear":
      return s.monthOfYears.has(value);
    case "year":
      return s.years.has(value);
    case "day":
      return s.days.has(value);
    case "policyTail":
      return s.policyTails.has(value);
  }
}

/** numbersUsed 항목 → 토큰 목록(모델의 자기 신고도 같은 규칙으로 정규화). */
export function usedTokens(v: number | string): { kind: TokenKind; value: string; raw: string }[] {
  if (typeof v === "number") return Number.isFinite(v) ? [{ kind: "number", value: canonical(String(v))!, raw: String(v) }] : [];
  const t = v.trim();
  const ym = YM.exec(t);
  if (ym) return [{ kind: "month", value: t, raw: t }];
  if (DECIMAL.test(t)) return [{ kind: "number", value: canonical(t)!, raw: t }];
  return extractTokens(t).map(({ kind, value, raw }) => ({ kind, value, raw }));
}

/** 컨텍스트 키 경로(G5): "line.amount", "deferrals.0.dueYm" 와 그 모든 접두("deferrals", "deferrals.0"). */
export function contextKeys(ctx: Json): Set<string> {
  const out = new Set<string>();
  const walk = (v: Json | undefined, path: string) => {
    if (path) out.add(path);
    if (v === null || v === undefined || typeof v !== "object") return;
    if (Array.isArray(v)) v.forEach((x: Json, i: number) => walk(x, path ? `${path}.${i}` : String(i)));
    else for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(ctx, "");
  return out;
}

/** 인용 필드 표기 정규화: "a[0].b" → "a.0.b", "a[].b"·"a[*].b" → "a.*.b". */
export function normalizeField(f: string): string {
  return f
    .trim()
    .replace(/\[(\d+)\]/g, ".$1")
    .replace(/\[\*?\]/g, ".*")
    .replace(/^\.+|\.+$/g, "");
}

export function fieldInContext(field: string, keys: ReadonlySet<string>): boolean {
  const f = normalizeField(field);
  if (!f) return false;
  if (!f.includes("*")) return keys.has(f);
  const re = new RegExp(`^${f.split(".").map((p) => (p === "*" ? "\\d+" : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("\\.")}$`);
  for (const k of keys) if (re.test(k)) return true;
  return false;
}
