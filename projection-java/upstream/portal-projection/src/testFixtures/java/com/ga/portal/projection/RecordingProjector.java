package com.ga.portal.projection;

import com.ga.platform.core.tenant.TenantId;

import java.util.ArrayList;
import java.util.List;

/**
 * Phase 1 프로젝터: 적용한 {@code (tenant, seq, eventId, type)}을 메모리에 남기기만 한다 — 뷰 표는 건드리지 않는다(Phase 1 지시문 D-6).
 * 영속 기록은 {@code ingest_event}가 한다. 여러 워커 스레드가 부를 수 있다.
 */
public final class RecordingProjector implements Projector {

    /** 적용된 이벤트 하나. */
    public record Applied(TenantId tenant, long seq, String eventId, String type) {
    }

    private final List<Applied> applied = new ArrayList<>();

    @Override
    public synchronized ProjectionResult apply(TenantId tenant, Envelope envelope) {
        applied.add(new Applied(tenant, envelope.seq(), envelope.eventId(), envelope.type()));
        return ProjectionResult.recordedOnly();
    }

    /** 지금까지 적용한 것(호출 순서). */
    public synchronized List<Applied> applied() {
        return List.copyOf(applied);
    }

    /** 한 테넌트에 적용한 것. */
    public synchronized List<Applied> applied(TenantId tenant) {
        return applied.stream().filter(a -> a.tenant().equals(tenant)).toList();
    }
}
