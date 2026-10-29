package com.ga.portal.domain;

import java.util.Optional;

/**
 * 계약 상태 플래그(설계서 §5 {@code policy_flag.flag_type}). 엔진 {@code PolicyEventObserved.eventType}에서의 매핑은 {@link #of}
 * (Phase 2 지시문 D-10) — {@code REINSTATE}는 플래그가 아니라 해제다.
 */
public enum FlagType {
    CANCELLED,
    LAPSED,
    OVERDUE,
    REDUCED;

    /** 계약 어휘의 {@code eventType} → 플래그. {@code REINSTATE}·모르는 값이면 비어 있다. */
    public static Optional<FlagType> of(String eventType) {
        return Optional.ofNullable(switch (eventType) {
            case "CANCEL", "WITHDRAW" -> CANCELLED;
            case "LAPSE" -> LAPSED;
            case "REDUCE" -> REDUCED;
            case "PAYMENT_OVERDUE" -> OVERDUE;
            default -> null;
        });
    }
}
