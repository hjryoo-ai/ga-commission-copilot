package com.ga.portal.projection.testing;

import com.ga.platform.core.tenant.TenantId;
import com.ga.portal.projection.Envelope;
import com.ga.portal.projection.NotificationDeriver;
import com.ga.portal.projection.ProjectionResult;

/** 아무것도 하지 않는 파생기 — 시험 전용(포털 Phase 6에 제품 코드에서 내렸다: 운영 조립은 늘 실제 파생기다). 알림을 보지 않는 적용기 시험이 쓴다. */
public final class NoopNotificationDeriver implements NotificationDeriver {

    @Override
    public void derive(TenantId tenant, Envelope envelope, ProjectionResult result) {
        // 시험 — 알림 없음
    }
}
