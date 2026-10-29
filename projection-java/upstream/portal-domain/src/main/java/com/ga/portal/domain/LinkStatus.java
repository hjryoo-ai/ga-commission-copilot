package com.ga.portal.domain;

/** {@code identity_link.status}(V5): {@code REVOKED}는 모든 요청을 거부한다(행은 지우지 않는다 — 감사가 그 주체를 가리킨다). */
public enum LinkStatus {
    ACTIVE,
    REVOKED
}
