package com.ga.portal.domain;

/** 분급 항목 상태(설계서 §5 {@code deferral_item.status}, 화면 라벨은 §6.2). */
public enum DeferralStatus {
    /** 예정. */
    SCHEDULED,
    /** 이번 달 지급 대상. */
    RELEASED,
    /** 보류 — 사유 표시. */
    HELD,
    /** 취소 — 사유 표시(해약·실효 등). 전망에서 제외. */
    CANCELLED
}
