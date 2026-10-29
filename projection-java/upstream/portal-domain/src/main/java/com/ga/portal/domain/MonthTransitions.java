package com.ga.portal.domain;

import java.util.Optional;

/**
 * 월 상태 전이(설계서 §6.2, Phase 2 계획 ③ 표·승인 Q7). 표 밖은 거부: 마감월(CONFIRMED·PAID)의 라인·예상·확정과 PAID의 두 번째 지급은
 * {@link ViolationReason#CLOSED_MONTH}, 확정 전의 지급은 {@link ViolationReason#STATE_MISMATCH}. 라인은 상태를 바꾸지 않는다(ESTIMATED인 달에
 * 새 라인 → ESTIMATED 그대로 — 예상의 기준 시각이 낡음을 말한다).
 */
public final class MonthTransitions {

    private MonthTransitions() {
    }

    /** {@code current}가 비어 있으면 그 달 행이 아직 없다. */
    public static TransitionVerdict<MonthStatus> next(Optional<MonthStatus> current, MonthEvent event) {
        MonthStatus from = current.orElse(null);
        if (from != null && from.isClosed() && event != MonthEvent.PAYOUT) {
            return new TransitionVerdict.Rejected<>(ViolationReason.CLOSED_MONTH);
        }
        return switch (event) {
            case LINE -> new TransitionVerdict.Next<>(from == null ? MonthStatus.PROVISIONAL : from);
            case ESTIMATED -> new TransitionVerdict.Next<>(MonthStatus.ESTIMATED);
            case CONFIRMED -> new TransitionVerdict.Next<>(MonthStatus.CONFIRMED);
            case PAYOUT -> from == MonthStatus.CONFIRMED
                    ? new TransitionVerdict.Next<>(MonthStatus.PAID)
                    : new TransitionVerdict.Rejected<>(from == MonthStatus.PAID ? ViolationReason.CLOSED_MONTH : ViolationReason.STATE_MISMATCH);
        };
    }
}
