package com.ga.portal.domain.view;

/**
 * 한 설계사·한 달의 라인 합(설계서 §5 집계 정의): {@code gross} = Σ comm_type ∉ {CLAWBACK, ADJUSTMENT}, {@code clawbackOffset} = Σ CLAWBACK,
 * {@code adjustment} = Σ ADJUSTMENT — 전 상태 합산(취소 원본·reversal 모두).
 */
public record MonthSums(long gross, long clawbackOffset, long adjustment) {

    public static final MonthSums ZERO = new MonthSums(0, 0, 0);
}
