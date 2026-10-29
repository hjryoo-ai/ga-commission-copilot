package com.ga.portal.domain;

/**
 * 월 지급 상태(설계서 §5 {@code earnings_month.status}, 화면 라벨은 §6.2). 순서가 곧 진행 방향이다 — CONFIRMED·PAID인 월의 라인은
 * 이후 이벤트로 바뀌지 않는다(불변 규약 4).
 */
public enum MonthStatus {
    /** 라인만 있다 — "예상", 세후는 야간 산출 뒤. */
    PROVISIONAL,
    /** StatementEstimated 수신 — "예상"(기준 시각 표시). */
    ESTIMATED,
    /** StatementConfirmed 수신 — "확정". */
    CONFIRMED,
    /** PayoutCompleted 수신 — "지급완료". */
    PAID;

    /** 마감된 월(뷰 변경 금지). */
    public boolean isClosed() {
        return this == CONFIRMED || this == PAID;
    }
}
