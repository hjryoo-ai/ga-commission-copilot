package com.ga.portal.projection;

import com.ga.portal.domain.ViolationReason;

import java.util.Objects;

/**
 * 프로젝터가 이벤트를 거부한다(Phase 2 계획 ④) — 적용기가 그 이벤트의 트랜잭션을 롤백하고 {@code PROJECTOR_ERROR}로 테넌트를 멈춘다.
 * 메시지는 {@code "{reason} {keys}"}이고 keys에는 seq·eventId·키 이름만 쓴다(값·금액 없음 — 평문 규약).
 */
public final class ProjectionViolation extends RuntimeException {

    private final ViolationReason reason;

    public ProjectionViolation(ViolationReason reason, String keys) {
        super(Objects.requireNonNull(reason, "reason").name() + " " + Objects.requireNonNull(keys, "keys"), null, false, false);
        this.reason = reason;
    }

    public ViolationReason reason() {
        return reason;
    }
}
