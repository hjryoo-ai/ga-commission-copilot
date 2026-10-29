package com.ga.portal.domain.notify;

import com.ga.portal.domain.NotificationType;

import java.util.Optional;

/**
 * 종류 → {@code params} 모양과 화면 경로(포털 Phase 6 계획 ③). 계약의 {@code discriminator.mapping}과 같은 표다({@code InboxApiContractTest}가 대조).
 * 계약 상태 알림에는 경로가 없다(계획 Q19 — 플래그 프로젝터는 원장을 읽지 않는다).
 */
public final class NotificationShapes {

    private NotificationShapes() {
    }

    public static Class<? extends NotificationParams> paramsType(NotificationType type) {
        return switch (type) {
            case LIMIT_WARN, LIMIT_CRIT, LIMIT_FULL, LIMIT_REBASE -> NotificationParams.Ledger.class;
            case LIMIT_CUT, CLAWBACK -> NotificationParams.Line.class;
            case DEFER_HELD, DEFER_CANCELLED -> NotificationParams.Deferral.class;
            case POLICY_PAYMENT_OVERDUE, POLICY_LAPSE, POLICY_CANCEL -> NotificationParams.Policy.class;
            case STMT_CONFIRMED, PAYOUT -> NotificationParams.Month.class;
            case INQUIRY_ANSWERED -> NotificationParams.Inquiry.class;
        };
    }

    /** 그 종류에 맞는 모양인지(저장·읽기 양쪽이 확인한다). */
    public static boolean fits(NotificationType type, NotificationParams params) {
        return paramsType(type).isInstance(params);
    }

    /** 화면 경로 — 모양에서만 나온다. */
    public static Optional<String> link(NotificationParams params) {
        return switch (params) {
            case NotificationParams.Ledger l -> Optional.of(ScreenLinks.limit(l.ledgerId()));
            case NotificationParams.Line l -> Optional.of(ScreenLinks.line(l.calcId()));
            case NotificationParams.Deferral d -> Optional.of(ScreenLinks.line(d.calcId()));
            case NotificationParams.Policy p -> Optional.empty();
            case NotificationParams.Month m -> Optional.of(ScreenLinks.statement(m.ym()));
            case NotificationParams.Inquiry i -> Optional.of(ScreenLinks.inquiry(i.inquiryId()));
        };
    }
}
