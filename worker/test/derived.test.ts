import { describe, expect, it } from "vitest";
import { DerivedNumbers } from "../src/domain/DerivedNumbers";

// PHASES Phase 2 항목 4, 설계서 v0.1.12 §7·상위 §6.3: 합계·잔여·소진율·단계만, 정수 원.
const L = (comm_type: string, amount: number) => ({ comm_type, amount });

describe("DerivedNumbers", () => {
  it("월 합산: CLAWBACK → clawback_offset, ADJUSTMENT → adjustment, 나머지 → gross(적재기 재검사와 같은 분류)", () => {
    const lines = [L("FY_COMM", 1_000_000), L("INCENTIVE", 800_000), L("FY_COMM", -500_000), L("CLAWBACK", -100_000), L("ADJUSTMENT", 25_000)];
    expect(DerivedNumbers.monthSums(lines)).toEqual({ gross: 1_300_000, clawback_offset: -100_000, adjustment: 25_000 });
    expect(DerivedNumbers.monthMatches({ gross: 1_300_000, clawback_offset: -100_000, adjustment: 25_000 }, lines)).toBe(true);
    expect(DerivedNumbers.monthMatches({ gross: 1_300_001, clawback_offset: -100_000, adjustment: 25_000 }, lines)).toBe(false);
    expect(DerivedNumbers.monthMatches({ gross: 0, clawback_offset: 0, adjustment: 0 }, [])).toBe(true);
  });

  it("byType: 유형별 합, 키는 유형 이름 순", () => {
    expect(DerivedNumbers.byType([L("RENEWAL", 300), L("FY_COMM", 1_000), L("CLAWBACK", -100), L("FY_COMM", -400)])).toEqual({ CLAWBACK: -100, FY_COMM: 600, RENEWAL: 300 });
    expect(Object.keys(DerivedNumbers.byType([L("Z", 1), L("A", 1)]))).toEqual(["A", "Z"]);
  });

  it("remaining = limit − accum(음수 허용 — 단계가 FULL로 본다)", () => {
    expect(DerivedNumbers.remaining(1_800_000, 945_000)).toBe(855_000);
    expect(DerivedNumbers.remaining(1_000, 1_200)).toBe(-200);
  });

  it("utilization: 0 쪽 버림 소수 1자리, 한도 0이면 생략 — A-1 945,000 / 1,800,000 = 52.5%", () => {
    expect(DerivedNumbers.utilization(945_000, 1_800_000)).toBe("52.5%");
    expect(DerivedNumbers.utilization(1_799_999, 1_800_000)).toBe("99.9%");
    expect(DerivedNumbers.utilization(1_800_000, 1_800_000)).toBe("100.0%");
    expect(DerivedNumbers.utilization(-720_000, 2_250_000)).toBe("-32.0%");
    expect(DerivedNumbers.utilization(-1, 3)).toBe("-33.3%");
    expect(DerivedNumbers.utilization(0, 1)).toBe("0.0%");
    expect(DerivedNumbers.utilization(5, 0)).toBeUndefined();
    for (const s of ["52.5%", "-32.0%", "100.0%"]) expect(s).toMatch(/^-?[0-9]+\.[0-9]%$/);
  });

  it("stage: 상위 LimitStageTest와 같은 경계(정수 bp 비교, 잔여 ≤ 0 FULL)", () => {
    const st = (a: number, l: number) => DerivedNumbers.stage(a, l, 8000, 9500);
    expect([st(7_999, 10_000), st(8_000, 10_000), st(9_499, 10_000), st(9_500, 10_000), st(9_999, 10_000), st(10_000, 10_000), st(12_000, 10_000)]).toEqual([
      "OK",
      "WARN",
      "WARN",
      "CRIT",
      "CRIT",
      "FULL",
      "FULL",
    ]);
    expect([st(1_799_775, 2_250_000), st(1_800_000, 2_250_000), st(0, 0), st(-720_000, 2_250_000)]).toEqual(["OK", "WARN", "FULL", "OK"]);
    expect(DerivedNumbers.stage(80, 100, 8050, 9500)).toBe("OK");
  });

  it("정수 원이 아니면 멈춘다(규약 8)", () => {
    expect(() => DerivedNumbers.monthSums([L("FY_COMM", 0.5)])).toThrow(/정수/);
    expect(() => DerivedNumbers.remaining(Number.MAX_SAFE_INTEGER, -1)).toThrow(/정수/);
    expect(() => DerivedNumbers.utilization(1.5, 10)).toThrow(/정수/);
  });
});
