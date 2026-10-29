package com.ga.portal.domain.view;

import com.ga.portal.domain.AgentStatus;

import java.time.LocalDate;
import java.util.Objects;
import java.util.Optional;

/** {@code agent_profile} 한 행 — {@code AgentSnapshot}. */
public record AgentRow(String agentId, String name, Optional<String> grade, String orgPath, Optional<String> role, AgentStatus status,
                       LocalDate validFrom, long lastSeq) {

    public AgentRow {
        Objects.requireNonNull(agentId, "agentId");
        Objects.requireNonNull(name, "name");
        Objects.requireNonNull(grade, "grade");
        Objects.requireNonNull(orgPath, "orgPath");
        Objects.requireNonNull(role, "role");
        Objects.requireNonNull(status, "status");
        Objects.requireNonNull(validFrom, "validFrom");
    }
}
