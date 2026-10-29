package com.ga.portal.domain;

/**
 * 문의 분류 — {@code inquiry.category}(V7 {@code CHECK}, {@code StatusEnumDdlTest}가 대조)와 계약 {@code InquiryRequest.category}(포털 Phase 6 계획 Q5).
 * 앞의 넷은 라인 하나에 대한 문의라 {@code calcId}가 필수다(V7 {@code CHECK}·계약 {@code if/then}), {@link #OTHER}는 선택.
 */
public enum InquiryCategory {
    AMOUNT,
    LIMIT,
    CLAWBACK,
    DEFERRAL,
    OTHER;

    public boolean requiresCalcId() {
        return this != OTHER;
    }
}
