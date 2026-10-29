package com.ga.portal.domain.access;

/**
 * 404 거부 사유(계획 승인 Q6) — 감사 {@code audit_access.detail}과 지표 {@code reason} 태그에만 쓰이고 응답에는 없다(응답은 한 바이트). 닫힌 코드이며 값을 싣지
 * 않는다.
 */
public enum DenyReason {
    /** 그 테넌트에 이 subject의 {@code identity_link}가 없다. */
    NO_LINK,
    /** 링크가 {@code REVOKED}. */
    REVOKED,
    /** 역할이 이 진입점에 허용되지 않는다(설계사 조회는 {@code AGENT}만 — {@code MANAGER}는 v2, {@code OPERATOR}는 CLI). */
    ROLE,
    /** 그 설계사의 자원 중에 이 키가 없다(남의 키 포함 — 구별하지 않는다). */
    MISSING
}
