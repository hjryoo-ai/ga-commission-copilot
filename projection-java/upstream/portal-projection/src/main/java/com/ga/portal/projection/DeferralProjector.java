package com.ga.portal.projection;

import com.ga.portal.domain.DeferralStatus;
import com.ga.portal.domain.DeferralTransitions;
import com.ga.portal.domain.ViolationReason;
import com.ga.portal.domain.view.DeferralRow;
import com.ga.portal.projection.view.ViewStore;

import java.util.Optional;

/** 분급(Phase 2 계획 ②·③): 예약 → {@code deferral_item} insert(중복은 독), 상태 변경 → 엔진 전이·사유 짝·{@code from} 대조(D-9, 승인 Q8). */
final class DeferralProjector {

    private DeferralProjector() {
    }

    static void scheduled(ViewStore store, Envelope e) {
        Payload p = new Payload(e.payload());
        if (store.deferral(p.str("scheduleId")).isPresent()) {
            throw Projection.violation(ViolationReason.DUPLICATE_KEY, e, "scheduleId");
        }
        store.insertDeferral(new DeferralRow(p.str("scheduleId"), p.str("agentId"), p.str("policyNo"), p.str("sourceCalcId"), p.str("dueYm"),
                p.lng("amount"), p.str("payCondition"), DeferralStatus.SCHEDULED, p.str("reason"), p.str("curveVersionId"), Optional.empty(),
                e.seq()));
    }

    static Change.DeferralChanged changed(ViewStore store, Envelope e) {
        Payload p = new Payload(e.payload());
        DeferralRow row = store.deferral(p.str("scheduleId"))
                .orElseThrow(() -> Projection.violation(ViolationReason.UNKNOWN_REFERENCE, e, "scheduleId"));
        String reason = p.str("reason");
        DeferralStatus to = Projection.accept(DeferralTransitions.next(row.status(), DeferralStatus.valueOf(p.str("from")),
                DeferralStatus.valueOf(p.str("to")), reason), e, "deferral transition");
        DeferralRow after = row.transitioned(to, reason, e.seq());
        store.saveDeferral(after);
        return new Change.DeferralChanged(row, after);
    }
}
