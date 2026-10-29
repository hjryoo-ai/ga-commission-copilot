package com.ga.portal.domain;

/**
 * 월 세후(원천세·순액)를 마지막으로 쓴 이벤트(설계서 §5 {@code earnings_month.net_basis}, Phase 2 승인 Q1). 화면 라벨 "확정(세후 예상)"은
 * {@code status = CONFIRMED}이고 이 값이 {@link #ESTIMATE}일 때다(엔진 v1은 마감 이벤트에 세액을 싣지 않는다). NULL = 세후 없음.
 */
public enum NetBasis {
    /** StatementEstimated. */
    ESTIMATE,
    /** StatementConfirmed(세액·순액이 실려 왔을 때). */
    CONFIRM,
    /** PayoutCompleted(세액·순액이 실려 왔을 때). */
    PAYOUT
}
