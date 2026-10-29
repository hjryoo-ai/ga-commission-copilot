package com.ga.portal.domain;

import java.util.Map;
import java.util.Set;

/**
 * 분급 항목 전이(Phase 2 계획 ③·승인 Q8 — 엔진 {@code ScheduleEntry}의 전이 그대로): SCHEDULED → RELEASED·HELD·CANCELLED, HELD → CANCELLED.
 * 도착 상태와 사유(계약 v1.2 닫힌 어휘)의 짝: RELEASED↔DUE_RELEASED, HELD↔POLICY_NOT_INFORCE, CANCELLED↔{POLICY_TERMINATED, SOURCE_REVERSED}.
 * 저장된 상태와 이벤트의 {@code from}이 다르면(지시문 D-9) 그것도 거부다.
 */
public final class DeferralTransitions {

    private static final Map<DeferralStatus, Set<DeferralStatus>> ALLOWED = Map.of(
            DeferralStatus.SCHEDULED, Set.of(DeferralStatus.RELEASED, DeferralStatus.HELD, DeferralStatus.CANCELLED),
            DeferralStatus.HELD, Set.of(DeferralStatus.CANCELLED),
            DeferralStatus.RELEASED, Set.of(),
            DeferralStatus.CANCELLED, Set.of());

    private static final Map<DeferralStatus, Set<String>> REASONS = Map.of(
            DeferralStatus.RELEASED, Set.of("DUE_RELEASED"),
            DeferralStatus.HELD, Set.of("POLICY_NOT_INFORCE"),
            DeferralStatus.CANCELLED, Set.of("POLICY_TERMINATED", "SOURCE_REVERSED"));

    private DeferralTransitions() {
    }

    public static TransitionVerdict<DeferralStatus> next(DeferralStatus stored, DeferralStatus from, DeferralStatus to, String reason) {
        if (stored != from || !ALLOWED.get(from).contains(to) || !REASONS.getOrDefault(to, Set.of()).contains(reason)) {
            return new TransitionVerdict.Rejected<>(ViolationReason.STATE_MISMATCH);
        }
        return new TransitionVerdict.Next<>(to);
    }
}
