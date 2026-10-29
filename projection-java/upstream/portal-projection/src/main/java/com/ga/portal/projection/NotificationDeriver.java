package com.ga.portal.projection;

import com.ga.platform.core.tenant.TenantId;

/**
 * 알림 파생 포트(Phase 1 지시문 D-6 — 규칙과 출력은 포털 Phase 6, 설계서 §6.5): 적용기와 같은 트랜잭션에서 프로젝터 다음에 불린다. 운영 구현은
 * {@code portal-app}의 {@code JdbcNotificationDeriver}, 아무것도 하지 않는 구현은 시험 픽스처에만 있다. 재구축은 이 포트를 부르지 않는다(§6.7).
 */
public interface NotificationDeriver {

    void derive(TenantId tenant, Envelope envelope, ProjectionResult result);
}
