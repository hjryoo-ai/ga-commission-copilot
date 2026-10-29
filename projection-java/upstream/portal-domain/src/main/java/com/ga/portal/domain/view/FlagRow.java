package com.ga.portal.domain.view;

import com.ga.portal.domain.FlagType;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;
import java.util.Optional;

/** {@code policy_flag} 한 행 — {@code reason}은 플래그를 연 원 이벤트 유형(D-10), {@code clearedAt}이 비면 열려 있다. */
public record FlagRow(String policyNo, String agentId, FlagType flagType, LocalDate occurredOn, Optional<Instant> clearedAt,
                      Optional<String> reason) {

    public FlagRow {
        Objects.requireNonNull(policyNo, "policyNo");
        Objects.requireNonNull(agentId, "agentId");
        Objects.requireNonNull(flagType, "flagType");
        Objects.requireNonNull(occurredOn, "occurredOn");
        Objects.requireNonNull(clearedAt, "clearedAt");
        Objects.requireNonNull(reason, "reason");
    }

    public boolean isOpen() {
        return clearedAt.isEmpty();
    }

    public FlagRow cleared(Instant at) {
        return new FlagRow(policyNo, agentId, flagType, occurredOn, Optional.of(at), reason);
    }
}
