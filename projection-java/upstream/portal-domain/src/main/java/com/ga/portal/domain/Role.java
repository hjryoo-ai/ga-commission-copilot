package com.ga.portal.domain;

/**
 * {@code identity_link.role}(V5, 설계서 §9 v1.6) — 역할은 토큰 클레임이 아니라 이 행에서만 온다(불변 규약 3). {@code AGENT} = 설계사 본인 조회,
 * {@code MANAGER} = 조직장(v2 — Phase 3에서는 {@code /api/v1/me/**}를 거부), {@code OPERATOR} = 운영 CLI(설계사 없음 — {@code agent_id} NULL).
 */
public enum Role {
    AGENT,
    MANAGER,
    OPERATOR
}
