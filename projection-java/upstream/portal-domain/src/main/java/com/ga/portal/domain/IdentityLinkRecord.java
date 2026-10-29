package com.ga.portal.domain;

import com.ga.platform.core.tenant.AgentId;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;

/**
 * {@code identity_link} 한 행(V5). {@code agentId}는 {@code OPERATOR}만 비어 있고, {@code orgPath}(포털 사실 — 인가용, v2)는 {@code OPERATOR}만 비어
 * 있다 — 둘 다 DB CHECK가 강제하고 여기서도 확인한다. {@code agent_profile.org_path}(엔진 사실 — 표시용)와는 다른 출처다(계획 승인 Q2).
 */
public record IdentityLinkRecord(String subject, Optional<AgentId> agentId, Role role, LinkStatus status, Optional<String> orgPath,
                                 Instant linkedAt) {
    public IdentityLinkRecord {
        Objects.requireNonNull(subject, "subject");
        Objects.requireNonNull(agentId, "agentId");
        Objects.requireNonNull(role, "role");
        Objects.requireNonNull(status, "status");
        Objects.requireNonNull(orgPath, "orgPath");
        Objects.requireNonNull(linkedAt, "linkedAt");
        if ((role == Role.OPERATOR) != agentId.isEmpty()) {
            throw new IllegalArgumentException("agentId is empty exactly for OPERATOR");
        }
        if (role != Role.OPERATOR && orgPath.isEmpty()) {
            throw new IllegalArgumentException("orgPath is required for " + role);
        }
    }
}
