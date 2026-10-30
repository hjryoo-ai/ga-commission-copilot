// 한국어 수량 표현 정규화(설계서 §6.1 1·2·4). 텍스트와 컨텍스트가 같은 규칙으로 숫자 토큰이 된다.
// - 금액·건수·배수·회차는 kind "number" 하나다(S도 한 집합이라 단위로 나눌 이유가 없다). 부호는 뗀다 — "72만 원 환수" ↔ -720000.
// - "94만 5천 원"·"0.945백만"·"2천5백만" 같은 만/억 묶음은 정수로 접는다. 소수 연산은 문자열·BigInt로만 한다(double 금지, 규약 8).
// - 비율은 "%"·"퍼센트"가 붙은 것, 날짜는 YYYY-MM-DD·YYYY년 M월 D일·YYYY년 M월·yyyyMM·M월·D일.
// - 제외: 조항 번호(제12조), 순번(1번째·둘째), 목록 머리(1.), 식별자(calcId·ledgerId·설계사 ID·증권번호 — 설계사 ID·증권번호는 G6 몫).
//   마스킹 증권번호 뒷자리(***0001)는 제외가 아니라 kind "policyTail"로 컨텍스트의 마스킹 값과 대조한다.

export type TokenKind = "number" | "percent" | "date" | "month" | "monthOfYear" | "monthDay" | "year" | "day" | "policyTail";

export interface NumberToken {
  kind: TokenKind;
  /** 정규화 값: number·percent는 부호 없는 정준 소수 문자열, date는 YYYY-MM-DD, month는 yyyyMM, monthDay는 MM-DD. */
  value: string;
  /** 텍스트에서 잡힌 그대로. */
  raw: string;
  index: number;
}

/** 부호 없는 십진수(정수부 BigInt + 소수 자릿수). */
interface Dec {
  digits: bigint;
  scale: number;
}

function parseDec(s: string): Dec | null {
  const t = s.replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) return null;
  const frac = m[2] ?? "";
  return { digits: BigInt(m[1]! + frac), scale: frac.length };
}

function shift(d: Dec, pow10: number): Dec {
  if (pow10 >= d.scale) return { digits: d.digits * 10n ** BigInt(pow10 - d.scale), scale: 0 };
  return { digits: d.digits, scale: d.scale - pow10 };
}

function add(a: Dec, b: Dec): Dec {
  const scale = Math.max(a.scale, b.scale);
  return { digits: a.digits * 10n ** BigInt(scale - a.scale) + b.digits * 10n ** BigInt(scale - b.scale), scale };
}

/** 정준 문자열: 앞 0·소수 끝 0 제거("100.0" → "100", "052.50" → "52.5"). */
function show(d: Dec): string {
  const s = d.digits.toString().padStart(d.scale + 1, "0");
  if (d.scale === 0) return s;
  const int = s.slice(0, s.length - d.scale);
  const frac = s.slice(s.length - d.scale).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

/** 숫자 문자열(쉼표·부호 허용) → 정준 문자열. 숫자가 아니면 null. */
export function canonical(s: string): string | null {
  const d = parseDec(s.trim().replace(/^[-−+]/, ""));
  return d ? show(d) : null;
}

/** 소수 문자열 × 100(비율 후보: 지급률 "0.9" ↔ "90%"). */
export function percentOf(s: string): string | null {
  const d = parseDec(s.trim().replace(/^[-−+]/, ""));
  return d ? show(shift(d, 2)) : null;
}

const SMALL: Record<string, number> = { 십: 1, 백: 2, 천: 3 };
const BIG: Record<string, number> = { 만: 4, 억: 8, 조: 12 };

/** 만/억 묶음 표현 → 정준 문자열("94만 5천" → "945000", "0.945백만" → "945000", "2천5백만" → "25000000"). */
export function koreanAmount(expr: string): string | null {
  const parts = [...expr.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*([십백천])?\s*([만억조])?/g)];
  if (parts.length === 0) return null;
  let total: Dec = { digits: 0n, scale: 0 };
  let section: Dec = { digits: 0n, scale: 0 };
  for (const p of parts) {
    let n = parseDec(p[1]!);
    if (!n) return null;
    if (p[2]) n = shift(n, SMALL[p[2]]!);
    section = add(section, n);
    if (p[3]) {
      total = add(total, shift(section, BIG[p[3]]!));
      section = { digits: 0n, scale: 0 };
    }
  }
  return show(add(total, section));
}

const pad2 = (n: string) => n.padStart(2, "0");
const validMonth = (m: string) => Number(m) >= 1 && Number(m) <= 12;
const validDay = (d: string) => Number(d) >= 1 && Number(d) <= 31;

/** 빼는 구간(숫자 토큰이 아니다). */
const EXCLUDE: readonly RegExp[] = [
  /제\s*\d+\s*조(?:\s*의\s*\d+)?(?:\s*제?\s*\d+\s*항)?/g, // 조항 번호
  /\d+\s*(?:번째|째)/g, // 순번
  /(?:^|\n)\s*\d+[.)](?=\s)/g, // 목록 머리
  /\b[a-z]{1,2}-A\d{4}(?:-\d+)+\b/g, // 생성 ID(c-·l-·s-·a-·r-)
  /\bA-\d{4}\b/g, // 설계사 ID(G6)
  /\bPOL-\d{4}-\d{4,5}\b/g, // 증권번호(G6)
  /\b[A-Z][A-Z_]+:[^\s)]+/g, // 규칙 버전 ID(COMM_RATE:…)
];

interface Rule {
  re: RegExp;
  make: (m: RegExpExecArray) => Omit<NumberToken, "raw" | "index"> | null;
}

const RULES: readonly Rule[] = [
  { re: /\*{2,}(\d{4})/g, make: (m) => ({ kind: "policyTail", value: m[1]! }) },
  {
    re: /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,
    make: (m) => (validMonth(m[2]!) && validDay(m[3]!) ? { kind: "date", value: `${m[1]}-${pad2(m[2]!)}-${pad2(m[3]!)}` } : null),
  },
  {
    re: /(?<![\d.])(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?![\d])/g,
    make: (m) => (validMonth(m[2]!) && validDay(m[3]!) ? { kind: "date", value: `${m[1]}-${pad2(m[2]!)}-${pad2(m[3]!)}` } : null),
  },
  { re: /(\d{4})\s*년\s*(\d{1,2})\s*월/g, make: (m) => (validMonth(m[2]!) ? { kind: "month", value: `${m[1]}${pad2(m[2]!)}` } : null) },
  { re: /(?<![\d.,])(\d{4})[-./](\d{1,2})(?![\d.,])/g, make: (m) => (validMonth(m[2]!) ? { kind: "month", value: `${m[1]}${pad2(m[2]!)}` } : null) },
  { re: /(?<![\d.,])(20\d{2})(0[1-9]|1[0-2])(?![\d.,])/g, make: (m) => ({ kind: "month", value: `${m[1]}${m[2]}` }) },
  { re: /(?<![\d.,])(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, make: (m) => (validMonth(m[1]!) && validDay(m[2]!) ? { kind: "monthDay", value: `${pad2(m[1]!)}-${pad2(m[2]!)}` } : null) },
  { re: /(?<![\d.,])(\d{4})\s*년(?!\s*차)/g, make: (m) => ({ kind: "year", value: m[1]! }) },
  { re: /(?<![\d.,])(\d{1,2})\s*월(?![납별말초])/g, make: (m) => (validMonth(m[1]!) ? { kind: "monthOfYear", value: String(Number(m[1])) } : null) },
  { re: /(?<![\d.,])(\d{1,2})\s*일(?![시반부])/g, make: (m) => (validDay(m[1]!) ? { kind: "day", value: String(Number(m[1])) } : null) },
  {
    re: /(?<![\d.,])(\d[\d,]*(?:\.\d+)?)\s*(?:%|퍼센트|프로)/g,
    make: (m) => {
      const v = canonical(m[1]!);
      return v === null ? null : { kind: "percent", value: v };
    },
  },
  {
    // 만/억 묶음: (숫자+십백천)* 숫자 (십백천)?(만|억|조), 뒤에 같은 묶음·숫자(+십백천) 꼬리
    re: /(?<![\d.,])(?:\d[\d,]*(?:\.\d+)?\s*[십백천]\s*)*\d[\d,]*(?:\.\d+)?\s*[십백천]?\s*[만억조](?:\s*\d[\d,]*(?:\.\d+)?\s*[십백천]?\s*[만억조]?)*|(?<![\d.,])\d[\d,]*(?:\.\d+)?\s*[십백천](?=\s*원)/g,
    make: (m) => {
      const v = koreanAmount(m[0]);
      return v === null ? null : { kind: "number", value: v };
    },
  },
  {
    re: /(?<![\d.,])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d,])|(?<![\d.,])\d+(?:\.\d+)?(?![\d,])/g,
    make: (m) => {
      const v = canonical(m[0]);
      return v === null ? null : { kind: "number", value: v };
    },
  },
];

/** 텍스트의 숫자 토큰(설계서 §6.1 2). 근사어("약", "대략")는 떼지 않는다 — 근사 표현으로 빠져나가지 못한다. */
export function extractTokens(text: string): NumberToken[] {
  const taken = new Array<boolean>(text.length).fill(false);
  const mark = (from: number, to: number) => {
    for (let i = from; i < to; i++) taken[i] = true;
  };
  const free = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (taken[i]) return false;
    return true;
  };
  for (const re of EXCLUDE) for (const m of text.matchAll(re)) mark(m.index, m.index + m[0].length);
  const out: NumberToken[] = [];
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.re)) {
      const end = m.index + m[0].length;
      if (!free(m.index, end)) continue;
      const t = rule.make(m as RegExpExecArray);
      if (!t) continue;
      mark(m.index, end);
      out.push({ ...t, raw: m[0].trim(), index: m.index });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}
