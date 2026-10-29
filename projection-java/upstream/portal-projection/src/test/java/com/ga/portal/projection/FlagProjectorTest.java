package com.ga.portal.projection;

import com.ga.platform.core.tenant.TenantId;
import com.ga.portal.domain.FlagType;
import com.ga.portal.projection.testing.Envelopes;
import com.ga.portal.projection.testing.InMemoryViewStore;
import com.ga.portal.domain.view.FlagRow;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * C9(승인 Q12 — 시험 사례 10개, 지시문 "10종"은 DE-10): 매핑 5 + REINSTATE 해제 + 같은 플래그 재수신 upsert + 해제 뒤 재플래그 +
 * WITHDRAW 뒤 CANCEL(같은 CANCELLED, reason 갱신) + 다른 설계사의 같은 계약.
 */
class FlagProjectorTest {

    static final TenantId T = TenantId.of("GA01");
    private final InMemoryViewStore store = new InMemoryViewStore();
    private final ViewProjector projector = new ViewProjector(store);
    private long seq;

    private void observe(String agent, String type, String on) {
        seq++;
        projector.apply(T, Envelopes.of((tools.jackson.databind.node.ObjectNode) Envelopes.JSON.readTree("""
                {"eventId":"5eed0000-0000-4000-8000-%012x","seq":%d,"type":"PolicyEventObserved","version":1,"occurredAt":"%sT09:00:00+09:00",
                 "aggregate":{"kind":"POLICY","id":"POL-1"},"payload":{"policyNo":"POL-1","agentId":"%s","eventType":"%s","occurredOn":"%s"}}"""
                .formatted(0xf000 + seq, seq, on, agent, type, on))));
    }

    private List<FlagRow> flags(String agent) {
        return store.flagRows().stream().filter(f -> f.agentId().equals(agent)).toList();
    }

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource({"CANCEL,CANCELLED", "LAPSE,LAPSED", "WITHDRAW,CANCELLED", "REDUCE,REDUCED", "PAYMENT_OVERDUE,OVERDUE"})
    void cases1To5TheMappings(String eventType, FlagType flag) {
        observe("A1", eventType, "2027-02-15");
        assertThat(flags("A1")).singleElement().satisfies(f -> {
            assertThat(f.flagType()).isEqualTo(flag);
            assertThat(f.reason()).contains(eventType);
            assertThat(f.isOpen()).isTrue();
        });
    }

    @Test
    void case6ReinstateClearsEveryOpenFlagOfThePolicy() {
        observe("A1", "LAPSE", "2027-02-15");
        observe("A1", "PAYMENT_OVERDUE", "2027-02-20");
        observe("A1", "REINSTATE", "2027-03-02");
        assertThat(flags("A1")).hasSize(2).allSatisfy(f -> assertThat(f.clearedAt()).contains(Instant.parse("2027-03-02T00:00:00Z")));
    }

    @Test
    void case7TheSameFlagAgainIsAnUpsert() {
        observe("A1", "PAYMENT_OVERDUE", "2027-02-20");
        observe("A1", "PAYMENT_OVERDUE", "2027-03-20");
        assertThat(flags("A1")).singleElement().satisfies(f -> assertThat(f.occurredOn()).hasToString("2027-03-20"));
    }

    @Test
    void case8AFlagAfterReinstateOpensAgain() {
        observe("A1", "LAPSE", "2027-02-15");
        observe("A1", "REINSTATE", "2027-03-02");
        observe("A1", "LAPSE", "2027-05-15");
        assertThat(flags("A1")).singleElement().satisfies(f -> {
            assertThat(f.isOpen()).isTrue();
            assertThat(f.occurredOn()).hasToString("2027-05-15");
        });
    }

    @Test
    void case9CancelAfterWithdrawIsTheSameCancelledFlagWithTheNewReason() {
        observe("A1", "WITHDRAW", "2026-08-10");
        observe("A1", "CANCEL", "2026-08-12");
        assertThat(flags("A1")).singleElement().satisfies(f -> {
            assertThat(f.flagType()).isEqualTo(FlagType.CANCELLED);
            assertThat(f.reason()).contains("CANCEL");
        });
    }

    @Test
    void case10AnotherAgentOnTheSamePolicyHasItsOwnFlagsAndReinstateWithoutOpenFlagsIsNoop() {
        observe("A1", "CANCEL", "2027-02-15");
        observe("A2", "REINSTATE", "2027-03-02");
        observe("A2", "LAPSE", "2027-04-01");
        assertThat(flags("A1")).singleElement().satisfies(f -> assertThat(f.isOpen()).isTrue());
        assertThat(flags("A2")).singleElement().satisfies(f -> assertThat(f.flagType()).isEqualTo(FlagType.LAPSED));
    }
}
