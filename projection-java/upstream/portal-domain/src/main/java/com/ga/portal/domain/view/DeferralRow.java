package com.ga.portal.domain.view;

import com.ga.portal.domain.DeferralStatus;

import java.util.Objects;
import java.util.Optional;

/** {@code deferral_item} 한 행. {@code reason} = CURVE/LIMIT_DEFER, {@code statusReason} = 계약 v1.2 전이 사유. */
public record DeferralRow(String scheduleId, String agentId, String policyNo, String sourceCalcId, String dueYm, long amount, String payCondition,
                          DeferralStatus status, String reason, String curveVersionId, Optional<String> statusReason, long lastSeq) {

    public DeferralRow {
        Objects.requireNonNull(scheduleId, "scheduleId");
        Objects.requireNonNull(agentId, "agentId");
        Objects.requireNonNull(policyNo, "policyNo");
        Objects.requireNonNull(sourceCalcId, "sourceCalcId");
        Objects.requireNonNull(dueYm, "dueYm");
        Objects.requireNonNull(payCondition, "payCondition");
        Objects.requireNonNull(status, "status");
        Objects.requireNonNull(reason, "reason");
        Objects.requireNonNull(curveVersionId, "curveVersionId");
        Objects.requireNonNull(statusReason, "statusReason");
    }

    public DeferralRow transitioned(DeferralStatus to, String transitionReason, long seq) {
        return new DeferralRow(scheduleId, agentId, policyNo, sourceCalcId, dueYm, amount, payCondition, to, reason, curveVersionId,
                Optional.of(transitionReason), seq);
    }
}
