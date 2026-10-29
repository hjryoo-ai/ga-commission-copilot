package com.ga.portal.domain;

/**
 * 문의 상태 전이(포털 Phase 6 계획 ⑦ — 운영 CLI만 바꾼다): {@code OPEN → ANSWERED}(답변), {@code OPEN|ANSWERED → CLOSED}(종료). 닫힌 문의는 끝이고, 답변의
 * 수정·재답변은 없다(계획 ⑬).
 */
public final class InquiryTransitions {

    private InquiryTransitions() {
    }

    public static boolean canAnswer(InquiryStatus from) {
        return from == InquiryStatus.OPEN;
    }

    public static boolean canClose(InquiryStatus from) {
        return from == InquiryStatus.OPEN || from == InquiryStatus.ANSWERED;
    }
}
