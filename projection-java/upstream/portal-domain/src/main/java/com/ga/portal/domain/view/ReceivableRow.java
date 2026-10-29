package com.ga.portal.domain.view;

import com.ga.portal.domain.ReceivableStatus;

import java.util.Objects;

/** {@code clawback_item} 한 행 — 원금·잔액은 0 이상(계약 v1.2). */
public record ReceivableRow(String receivableId, String agentId, String originCalcId, long amount, long remaining, ReceivableStatus status,
                            long lastSeq) {

    public ReceivableRow {
        Objects.requireNonNull(receivableId, "receivableId");
        Objects.requireNonNull(agentId, "agentId");
        Objects.requireNonNull(originCalcId, "originCalcId");
        Objects.requireNonNull(status, "status");
    }
}
