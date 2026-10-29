package com.ga.portal.domain;

/** 문의 상태 — {@code inquiry.status}(V1 {@code CHECK}, {@code StatusEnumDdlTest}가 대조). 전이는 {@link InquiryTransitions}. */
public enum InquiryStatus {
    OPEN,
    ANSWERED,
    CLOSED
}
