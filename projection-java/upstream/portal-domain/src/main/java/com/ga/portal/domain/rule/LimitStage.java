package com.ga.portal.domain.rule;

/**
 * 한도 카드의 경고 단계(지시문 D-13, 계획 ⑤): {@code remaining ≤ 0} → {@code FULL}; {@code accum × 10000 ≥ crit_bp × limit} → {@code CRIT};
 * {@code ≥ warn_bp × limit} → {@code WARN}; 아니면 {@code OK}. 전부 {@code long} 곱셈 비교(넘치면 예외 — 조용히 틀리지 않는다), 저장 없음. 임계치는 테넌트
 * 설정의 백분율을 SQL이 정수 bp로 읽은 값(80.00% → 8000). 비율 문자열({@code utilization})과 비교하지 않는다 — 문자열은 표시 전용이다.
 */
public enum LimitStage {
    OK, WARN, CRIT, FULL;

    public static LimitStage of(long accumPaid, long limitAmount, long remaining, long warnBp, long critBp) {
        if (remaining <= 0) {
            return FULL;
        }
        long used = Math.multiplyExact(accumPaid, 10_000L);
        if (used >= Math.multiplyExact(critBp, limitAmount)) {
            return CRIT;
        }
        if (used >= Math.multiplyExact(warnBp, limitAmount)) {
            return WARN;
        }
        return OK;
    }
}
