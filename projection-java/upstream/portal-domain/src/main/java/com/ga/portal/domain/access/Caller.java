package com.ga.portal.domain.access;

import com.ga.platform.core.tenant.AgentId;
import com.ga.platform.core.tenant.TenantId;
import com.ga.portal.domain.Role;

import java.util.Objects;

/**
 * 조회 API의 호출자(포털 Phase 3 계획 ③): 테넌트는 토큰 발급자({@code iss})에서, 설계사·역할은 {@code identity_link}에서만 온다 — 토큰 클레임에서 오는 값은
 * 없다(불변 규약 3). 링크가 ACTIVE이고 설계사가 있는 경우에만 만들어진다(OPERATOR·REVOKED·링크 없음은 {@link NotFound}). 생성자는 앱의 인자 해석기만 부른다.
 */
public record Caller(TenantId tenant, AgentId agentId, Role role) {
    public Caller {
        Objects.requireNonNull(tenant, "tenant");
        Objects.requireNonNull(agentId, "agentId");
        Objects.requireNonNull(role, "role");
    }
}
