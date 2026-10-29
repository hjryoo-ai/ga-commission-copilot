package com.ga.portal.domain;

/** 월 상태를 움직이는 이벤트 종류({@link MonthTransitions}). */
public enum MonthEvent {
    /** CommissionCalculated·AdjustmentPosted — 그 달 라인. */
    LINE,
    /** StatementEstimated. */
    ESTIMATED,
    /** StatementConfirmed. */
    CONFIRMED,
    /** PayoutCompleted. */
    PAYOUT
}
