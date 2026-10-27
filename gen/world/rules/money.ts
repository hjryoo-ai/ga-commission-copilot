// 정수 원 산술(규약 8 — double 금지). decimalString은 분자/분모 정수로 바꿔 곱하고 버림한다.

function assertWon(n: number): number {
  if (!Number.isSafeInteger(n)) throw new Error(`not a safe integer won: ${n}`);
  return n;
}

function parseDecimal(s: string): { num: number; den: number } {
  const m = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(s);
  if (!m) throw new Error(`bad decimalString ${s}`);
  const frac = m[2] ?? "";
  const den = 10 ** frac.length;
  return { num: Number(m[1]) * den + Number(frac || "0"), den };
}

/** floor(won × rate₁ × rate₂ …) — 중간 곱이 안전 정수 범위를 넘으면 실패. */
export function mulFloor(won: number, ...rates: string[]): number {
  let num = assertWon(won);
  let den = 1;
  for (const r of rates) {
    const d = parseDecimal(r);
    num = assertWon(num * d.num);
    den = assertWon(den * d.den);
  }
  const q = Math.floor(num / den);
  return assertWon(q);
}

export function floorTo(won: number, unit: number): number {
  return assertWon(Math.floor(assertWon(won) / unit) * unit);
}

export function sum(values: readonly number[]): number {
  return assertWon(values.reduce((a, b) => assertWon(a + b), 0));
}
