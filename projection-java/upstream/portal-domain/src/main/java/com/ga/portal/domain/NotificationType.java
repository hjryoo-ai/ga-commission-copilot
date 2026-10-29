package com.ga.portal.domain;

/**
 * 알림 종류 — {@code notification.type}(V7 {@code CHECK}, {@code StatusEnumDdlTest}가 대조)와 계약 {@code Notification.type}(포털 Phase 6 계획 ③).
 * 심각도는 종류마다 하나다(설계서 §6.5 — 한도 단계는 표의 "INFO/WARN/CRIT"를 단계 순서로, 계획 Q18). 문장은 화면의 템플릿이 만든다 — 서버에는 없다(계획 Q1).
 */
public enum NotificationType {
    LIMIT_WARN(Severity.INFO),
    LIMIT_CRIT(Severity.WARN),
    LIMIT_FULL(Severity.CRIT),
    LIMIT_REBASE(Severity.INFO),
    LIMIT_CUT(Severity.WARN),
    CLAWBACK(Severity.WARN),
    DEFER_HELD(Severity.WARN),
    DEFER_CANCELLED(Severity.WARN),
    POLICY_PAYMENT_OVERDUE(Severity.WARN),
    POLICY_LAPSE(Severity.WARN),
    POLICY_CANCEL(Severity.WARN),
    STMT_CONFIRMED(Severity.INFO),
    PAYOUT(Severity.INFO),
    INQUIRY_ANSWERED(Severity.INFO);

    private final Severity severity;

    NotificationType(Severity severity) {
        this.severity = severity;
    }

    public Severity severity() {
        return severity;
    }
}
