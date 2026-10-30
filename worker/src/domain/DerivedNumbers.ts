// 파생 수의 유일한 자리(CLAUDE.md 규약 2, 설계서 v0.1.12 §7·§6.1 파생 허용값, PHASES Phase 2 항목 4).
// 합계·잔여·소진율·단계만 한다. 요율 곱하기·세액·환수액 계산은 엔진 영역이라 여기에도 없다.
// 금액은 정수 원(규약 8) — 들어오고 나가는 모든 금액을 Number.isSafeInteger로 검사한다.
// worker·web의 이 파일 밖 코드는 금액에 사칙연산을 하지 않는다(test/arch.test.ts "금액 사칙연산").

export interface LineAmount {
  comm_type: string;
  amount: number;
}

export interface MonthSums {
  gross: number;
  clawback_offset: number;
  adjustment: number;
}

export type LimitStage = "OK" | "WARN" | "CRIT" | "FULL";

function won(n: number, what: string): number {
  if (!Number.isSafeInteger(n)) throw new Error(`${what}: 정수 원이 아니다 (${n})`);
  return n;
}

/** 월 행 열로 가는 유형(상위 §5 불변식 1 — 적재기 재검사 gen/load/sql.ts monthInvariantSql과 같은 분류). */
function monthColumn(commType: string): keyof MonthSums {
  if (commType === "CLAWBACK") return "clawback_offset";
  if (commType === "ADJUSTMENT") return "adjustment";
  return "gross";
}

export class DerivedNumbers {
  private constructor() {}

  /** 라인 Σ를 월 행 세 열로(상위 §5 불변식 1). */
  static monthSums(lines: readonly LineAmount[]): MonthSums {
    const sums: MonthSums = { gross: 0, clawback_offset: 0, adjustment: 0 };
    for (const l of lines) {
      const col = monthColumn(l.comm_type);
      sums[col] = won(sums[col] + won(l.amount, "line.amount"), "month sum");
    }
    return sums;
  }

  /** 월 합산 검증: 라인 Σ와 earnings_month 행이 세 열 모두 같으면 true(다르면 그 달 monthDataStatus DRIFT — 설계서 v0.1.12 §7). */
  static monthMatches(month: MonthSums, lines: readonly LineAmount[]): boolean {
    const s = DerivedNumbers.monthSums(lines);
    return s.gross === won(month.gross, "gross") && s.clawback_offset === won(month.clawback_offset, "clawback_offset") && s.adjustment === won(month.adjustment, "adjustment");
  }

  /** 유형별 라인 합(상위 §7 byType). 키 순서는 유형 이름 순. */
  static byType(lines: readonly LineAmount[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const l of [...lines].sort((a, b) => (a.comm_type < b.comm_type ? -1 : a.comm_type > b.comm_type ? 1 : 0))) {
      out[l.comm_type] = won((out[l.comm_type] ?? 0) + won(l.amount, "line.amount"), "byType");
    }
    return out;
  }

  /** remaining = limit − accum(상위 §6.3). */
  static remaining(limitAmount: number, accumPaid: number): number {
    return won(won(limitAmount, "limit") - won(accumPaid, "accum"), "remaining");
  }

  /**
   * 소진율 표시 문자열(상위 §6.3·계약 Percent `^-?[0-9]+\.[0-9]%$`): 누적 × 1000 ÷ 한도를 0 쪽으로 버린 소수 1자리.
   * 99.99%를 100.0%로 올리지 않는다(설계서 v0.1.12). 한도 0이면 undefined(응답에서 생략). 비교·계산에 쓰지 않는다 — 단계는 stage().
   */
  static utilization(accumPaid: number, limitAmount: number): string | undefined {
    if (won(limitAmount, "limit") === 0) return undefined;
    const permille = (BigInt(won(accumPaid, "accum")) * 1000n) / BigInt(limitAmount); // BigInt 나눗셈은 0 쪽 버림
    const sign = permille < 0n ? "-" : "";
    const abs = permille < 0n ? -permille : permille;
    return `${sign}${abs / 10n}.${abs % 10n}%`;
  }

  /** 경고 단계(상위 LimitStage): 잔여 ≤ 0 → FULL, accum × 10000 ≥ crit_bp × limit → CRIT, ≥ warn_bp × limit → WARN, 아니면 OK. 정수 비교. */
  static stage(accumPaid: number, limitAmount: number, warnBp: number, critBp: number): LimitStage {
    if (DerivedNumbers.remaining(limitAmount, accumPaid) <= 0) return "FULL";
    const used = BigInt(accumPaid) * 10_000n;
    if (used >= BigInt(won(critBp, "critBp")) * BigInt(limitAmount)) return "CRIT";
    if (used >= BigInt(won(warnBp, "warnBp")) * BigInt(limitAmount)) return "WARN";
    return "OK";
  }
}
