package com.ga.portal.domain.view;

import com.ga.portal.domain.ReconSource;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;

/**
 * {@code recon_result} 한 행. 이벤트 대사(지시문 D-3)는 DRIFT일 때만 쓰고 키는 {@code (agent, closeYm, runAt = occurredAt, EVENT, seq)}
 * — 같은 키가 있으면 아무것도 하지 않는다(재구축·재적용 멱등, 승인 Q2).
 */
public record ReconRow(String agentId, String closeYm, Instant runAt, long portalGross, long portalOffset, long portalAdjustment,
                       Optional<Long> engineGross, Optional<Long> engineOffset, Optional<Long> engineAdjustment, Optional<Long> engineNet,
                       String status, ReconSource source, long sourceSeq) {

    public ReconRow {
        Objects.requireNonNull(agentId, "agentId");
        Objects.requireNonNull(closeYm, "closeYm");
        Objects.requireNonNull(runAt, "runAt");
        Objects.requireNonNull(engineGross, "engineGross");
        Objects.requireNonNull(engineOffset, "engineOffset");
        Objects.requireNonNull(engineAdjustment, "engineAdjustment");
        Objects.requireNonNull(engineNet, "engineNet");
        Objects.requireNonNull(status, "status");
        Objects.requireNonNull(source, "source");
    }
}
