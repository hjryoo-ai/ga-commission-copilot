package com.ga.portal.domain;

/**
 * 환수 채권 상태(설계서 §5 {@code clawback_item.status}, 계약 v1.2 {@code ClawbackReceivableUpdated.status} — 엔진 {@code ReceivableStatus}가
 * 정본). 전이는 {@link ReceivableTransitions}.
 */
public enum ReceivableStatus {
    /** 미상계 잔액 있음. */
    OPEN,
    /** 일부 상계. */
    OFFSET,
    /** 전액 상계 — 잔액 0. */
    CLOSED,
    /** 대손. */
    WRITTEN_OFF;

    /** 이후 갱신이 없는 상태. */
    public boolean isTerminal() {
        return this == CLOSED || this == WRITTEN_OFF;
    }
}
