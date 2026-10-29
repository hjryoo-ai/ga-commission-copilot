package com.ga.portal.projection;

import com.ga.platform.core.tenant.TenantId;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import static org.assertj.core.api.Assertions.assertThat;

/** Phase 1 기록 프로젝터 — 적용한 것을 순서대로, 테넌트별로 돌려준다. */
class RecordingProjectorTest {

    private static Envelope envelope(long seq, String id) {
        ObjectNode source = JsonMapper.builder().build().createObjectNode();
        return new Envelope(id, seq, "AgentSnapshot", 1, "2026-08-01T09:00:00+09:00", new Envelope.Aggregate("AGENT", "A0001"),
                source.objectNode(), source);
    }

    @Test
    void recordsInOrderPerTenant() {
        RecordingProjector p = new RecordingProjector();
        TenantId t1 = TenantId.of("GA01");
        TenantId t2 = TenantId.of("GA02");
        assertThat(p.apply(t1, envelope(1, "e1")).appliedTo()).isEmpty();
        p.apply(t2, envelope(1, "e2"));
        p.apply(t1, envelope(2, "e3"));
        assertThat(p.applied()).extracting(RecordingProjector.Applied::eventId).containsExactly("e1", "e2", "e3");
        assertThat(p.applied(t1)).extracting(RecordingProjector.Applied::seq).containsExactly(1L, 2L);
        assertThat(envelope(1, "e1").occurredAtTime().toInstant().toString()).isEqualTo("2026-08-01T00:00:00Z");
    }
}
