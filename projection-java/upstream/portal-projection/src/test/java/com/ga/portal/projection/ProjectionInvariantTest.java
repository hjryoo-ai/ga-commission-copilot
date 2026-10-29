package com.ga.portal.projection;

import com.ga.platform.core.tenant.TenantId;
import com.ga.portal.domain.ViolationReason;
import com.ga.portal.projection.testing.Envelopes;
import com.ga.portal.projection.testing.InMemoryViewStore;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.node.ObjectNode;

import java.util.List;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 독 판정(Phase 2 계획 ④)과 대사(D-3): 정상 스트림(A-1·엔진 cycle)을 한 줄 바꿔 적용한다. 거부는 {@link ProjectionViolation}(사유)로 —
 * 테넌트 정지·롤백은 적용기와 DB 시험(IngestWorkerIT)이 본다. 메시지에는 키만 있고 금액이 없다.
 */
class ProjectionInvariantTest {

    static final TenantId T = TenantId.of("GA01");

    /** A-1 앞 {@code upTo}건을 적용한 저장소와 프로젝터. */
    record Rig(InMemoryViewStore store, ViewProjector projector) {
        void apply(ObjectNode node) {
            projector.apply(T, Envelopes.of(node));
        }
    }

    static List<ObjectNode> a1() {
        return Envelopes.nodes(Envelopes.a1());
    }

    static List<ObjectNode> cycle() {
        return Envelopes.nodes(Envelopes.stream("engine-e1-cycle.jsonl"));
    }

    static Rig after(List<ObjectNode> stream, int upTo) {
        InMemoryViewStore store = new InMemoryViewStore();
        Rig rig = new Rig(store, new ViewProjector(store));
        stream.subList(0, upTo).forEach(rig::apply);
        return rig;
    }

    static ObjectNode changed(ObjectNode event, Consumer<ObjectNode> payload) {
        ObjectNode copy = event.deepCopy();
        payload.accept((ObjectNode) copy.path("payload"));
        return copy;
    }

    static void assertRejected(Rig rig, ObjectNode event, ViolationReason reason) {
        assertThatThrownBy(() -> rig.apply(event)).isInstanceOfSatisfying(ProjectionViolation.class, v -> {
            assertThat(v.reason()).isEqualTo(reason);
            // 키만 — 사유·seq·eventId 뒤에는 필드 이름(영문)뿐, 금액·이름 같은 값은 없다
            assertThat(v.getMessage()).matches(reason.name() + " seq [0-9]+ eventId [0-9a-f-]{36} [A-Za-z ]+");
        });
    }

    // ------------------------------------------------------------------ C4 마감월

    @Test
    void c4ALineForAClosedMonthIsPoison() {
        Rig rig = after(a1(), 7);   // 202608 PAID
        ObjectNode late = changed(a1().get(1), p -> p.put("calcId", "99"));
        assertRejected(rig, late, ViolationReason.CLOSED_MONTH);
        ObjectNode adjustment = (ObjectNode) Envelopes.JSON.readTree("""
                {"eventId":"5eed0000-0000-4000-8000-0000000000c4","seq":8,"type":"AdjustmentPosted","version":1,"occurredAt":"2026-09-20T09:00:00+09:00",
                 "aggregate":{"kind":"ADJUSTMENT","id":"7"},"payload":{"adjId":"7","targetCalcId":"1","agentId":"A-1001","amount":-1000,"closeYm":"202608","reason":"x"}}""");
        assertRejected(rig, adjustment, ViolationReason.CLOSED_MONTH);
    }

    @Test
    void c4AnEstimateOrASecondConfirmationOrPayoutOfAClosedMonthIsPoison() {
        Rig rig = after(a1(), 7);
        assertRejected(rig, a1().get(5), ViolationReason.CLOSED_MONTH);   // 두 번째 확정
        assertRejected(rig, a1().get(6), ViolationReason.CLOSED_MONTH);   // 두 번째 지급
        ObjectNode estimate = a1().get(10);   // A-1 seq 11(202702 잠정 명세)을 마감된 202608로
        ((ObjectNode) estimate.path("payload")).put("closeYm", "202608");
        ((ObjectNode) estimate.path("aggregate")).put("id", "A-1001:202608");
        assertRejected(rig, estimate, ViolationReason.CLOSED_MONTH);
    }

    @Test
    void aPayoutBeforeTheConfirmationIsPoison() {
        assertRejected(after(a1(), 5), a1().get(6), ViolationReason.STATE_MISMATCH);
    }

    // ------------------------------------------------------------------ C5 대사 불일치는 독이 아니다

    @Test
    void c5ADriftingConfirmationIsNotPoison() {
        Rig rig = after(a1(), 5);
        ProjectionResult r = rig.projector().apply(T, Envelopes.of(changed(a1().get(5), p -> p.put("gross", 1_799_999))));
        assertThat(r.drift()).isTrue();
        assertThat(rig.store().months()).filteredOn(m -> m.closeYm().equals("202608")).singleElement()
                .satisfies(m -> {
                    assertThat(m.dataStatus().name()).isEqualTo("DRIFT");
                    assertThat(m.status().name()).isEqualTo("CONFIRMED");
                    assertThat(m.gross()).as("portal sum unchanged").isEqualTo(1_800_000);
                });
        assertThat(rig.store().reconRows()).singleElement().satisfies(rec -> {
            assertThat(rec.source().name()).isEqualTo("EVENT");
            assertThat(rec.sourceSeq()).isEqualTo(6);
            assertThat(rec.portalGross()).isEqualTo(1_800_000);
            assertThat(rec.engineGross()).contains(1_799_999L);
        });
        // 인제스트는 계속된다 — 다음 이벤트(지급)도 적용되고, 같은 합계 불일치가 또 한 행(seq가 다르다)
        ProjectionResult paid = rig.projector().apply(T, Envelopes.of(changed(a1().get(6), p -> p.put("gross", 1_799_999))));
        assertThat(paid.drift()).isTrue();
        assertThat(rig.store().reconRows()).hasSize(2);
    }

    @Test
    void aMatchingConfirmationWritesNoReconRowAndAReappliedDriftIsIdempotent() {
        Rig rig = after(a1(), 6);
        assertThat(rig.store().reconRows()).isEmpty();
        assertThat(rig.store().months()).allSatisfy(m -> assertThat(m.dataStatus().name()).isEqualTo("OK"));
    }

    // ------------------------------------------------------------------ C7 원장

    @Test
    void c7TheAccumChainMustHold() {
        assertRejected(after(a1(), 4), changed(a1().get(4), p -> p.put("accumAfter", 1_799_000)), ViolationReason.ACCUM_CHAIN);
    }

    @Test
    void c7APositivePostingAboveTheLimitAndANegativeAccumArePoison() {
        Rig rig = after(a1(), 4);
        assertRejected(rig, changed(a1().get(4), p -> p.put("amount", 856_000).put("accumAfter", 1_801_000)), ViolationReason.OVER_LIMIT);
        Rig rig2 = after(a1(), 5);
        assertRejected(rig2, changed(a1().get(9), p -> p.put("postingSeq", 3).put("amount", -1_800_001).put("accumAfter", -1)),
                ViolationReason.NEGATIVE_ACCUM);
    }

    @Test
    void q6APostingSeqGapIsPoison() {
        assertRejected(after(a1(), 4), changed(a1().get(4), p -> p.put("postingSeq", 3)), ViolationReason.STATE_MISMATCH);
    }

    @Test
    void c7ARebaseWithoutAPostingSeqIsKeptBySeqAndALowerLimitIsNotAViolation() {
        Rig rig = after(a1(), 5);   // 누적 1,800,000
        ObjectNode rebase = (ObjectNode) Envelopes.JSON.readTree("""
                {"eventId":"5eed0000-0000-4000-8000-0000000000c7","seq":6,"type":"LimitLedgerRebased","version":1,"occurredAt":"2026-08-20T09:00:00+09:00",
                 "aggregate":{"kind":"LIMIT_LEDGER","id":"1"},"payload":{"ledgerId":"1","oldLimit":1800000,"newLimit":1200000,"monthlyPremium":100000,
                 "reason":"PREMIUM_REDUCED"}}""");
        rig.apply(rebase);
        assertThat(rig.store().ledgers()).singleElement().satisfies(l -> {
            assertThat(l.limitAmount()).isEqualTo(1_200_000);
            assertThat(l.accumPaid()).as("A-3: accum above the new limit is normal").isEqualTo(1_800_000);
        });
        assertThat(rig.store().history()).filteredOn(h -> h.kind().equals("REBASE")).singleElement().satisfies(h -> {
            assertThat(h.sourceSeq()).isEqualTo(6);
            assertThat(h.postingSeq()).isEmpty();
        });
        // 재산정 뒤 음수 환수 전기는 정상(DD-8 — 글자대로의 "accum ≤ limit"이면 여기서 멈췄다)
        rig.apply(changed(a1().get(9), p -> p.put("postingSeq", 3)).put("seq", 7));
        assertRejected(after(a1(), 5), changed(rebase, p -> p.put("oldLimit", 1_700_000)), ViolationReason.STATE_MISMATCH);
        assertRejected(after(a1(), 5), changed(rebase, p -> p.put("postingSeq", 1)), ViolationReason.STATE_MISMATCH);
    }

    // ------------------------------------------------------------------ C8 분급

    static ObjectNode scheduled() {
        return (ObjectNode) Envelopes.JSON.readTree("""
                {"eventId":"5eed0000-0000-4000-8000-0000000000d1","seq":2,"type":"DeferralScheduled","version":1,"occurredAt":"2027-02-01T09:00:00+09:00",
                 "aggregate":{"kind":"DEFERRAL_SCHEDULE","id":"S1"},"payload":{"scheduleId":"S1","sourceCalcId":"1","agentId":"A-1001","policyNo":"POL-2026-0001",
                 "dueYm":"202803","amount":50000,"payCondition":"INFORCE","curveVersionId":"CV1","reason":"CURVE"}}""");
    }

    static ObjectNode statusChanged(String from, String to, String reason) {
        return (ObjectNode) Envelopes.JSON.readTree("""
                {"eventId":"5eed0000-0000-4000-8000-0000000000d2","seq":3,"type":"DeferralStatusChanged","version":1,"occurredAt":"2028-03-01T09:00:00+09:00",
                 "aggregate":{"kind":"DEFERRAL_SCHEDULE","id":"S1"},"payload":{"scheduleId":"S1","from":"%s","to":"%s","reason":"%s"}}""".formatted(from, to, reason));
    }

    @Test
    void c8AFromMismatchAndAnUnknownScheduleArePoison() {
        Rig rig = after(a1(), 1);
        rig.apply(scheduled());
        assertRejected(rig, statusChanged("HELD", "CANCELLED", "POLICY_TERMINATED"), ViolationReason.STATE_MISMATCH);
        assertRejected(after(a1(), 1), statusChanged("SCHEDULED", "RELEASED", "DUE_RELEASED"), ViolationReason.UNKNOWN_REFERENCE);
        assertRejected(rig, statusChanged("SCHEDULED", "RELEASED", "POLICY_NOT_INFORCE"), ViolationReason.STATE_MISMATCH);   // 짝(Q8)
        rig.apply(statusChanged("SCHEDULED", "HELD", "POLICY_NOT_INFORCE"));
        assertRejected(rig, statusChanged("HELD", "RELEASED", "DUE_RELEASED"), ViolationReason.STATE_MISMATCH);   // DD-9
        rig.apply(statusChanged("HELD", "CANCELLED", "POLICY_TERMINATED"));
        assertThat(rig.store().deferrals()).singleElement().satisfies(d -> {
            assertThat(d.status().name()).isEqualTo("CANCELLED");
            assertThat(d.statusReason()).contains("POLICY_TERMINATED");
        });
    }

    // ------------------------------------------------------------------ Q4 키 중복, 참조

    @Test
    void q4ImmutableFactsWithAKnownKeyArePoison() {
        assertRejected(after(a1(), 2), a1().get(1), ViolationReason.DUPLICATE_KEY);   // calcId
        assertRejected(after(a1(), 1), a1().get(0), ViolationReason.DUPLICATE_KEY);   // ledgerId
        Rig rig = after(a1(), 1);
        rig.apply(scheduled());
        assertRejected(rig, scheduled(), ViolationReason.DUPLICATE_KEY);
        Rig cyc = after(cycle(), 16);
        assertRejected(cyc, cycle().get(15), ViolationReason.DUPLICATE_KEY);   // adjId
    }

    @Test
    void stateFactsAreUpserts() {
        Rig cyc = after(cycle(), 19);
        assertThat(cyc.store().receivables()).singleElement().satisfies(r -> assertThat(r.status().name()).isEqualTo("CLOSED"));
        Rig rig = after(a1(), 8);
        rig.apply(a1().get(7));   // 같은 해약 관측을 다시 — 같은 플래그 upsert
        assertThat(rig.store().flagRows()).hasSize(1);
    }

    @Test
    void q3AnAdjustmentNeedsItsTargetLineAndACutLineNeedsItsLedger() {
        Rig cyc = after(cycle(), 15);
        assertRejected(cyc, changed(cycle().get(15), p -> p.put("targetCalcId", "404")), ViolationReason.UNKNOWN_REFERENCE);
        assertRejected(cyc, changed(cycle().get(15), p -> p.put("agentId", "A-9999")), ViolationReason.STATE_MISMATCH);
        InMemoryViewStore store = new InMemoryViewStore();
        assertThatThrownBy(() -> new ViewProjector(store).apply(T, Envelopes.of(a1().get(2))))
                .isInstanceOfSatisfying(ProjectionViolation.class, v -> assertThat(v.reason()).isEqualTo(ViolationReason.UNKNOWN_REFERENCE));
    }

    @Test
    void receivableInvariantsAreChecked() {
        Rig cyc = after(cycle(), 10);   // 채권 OPEN 1,323,000
        assertRejected(cyc, changed(cycle().get(16), p -> p.put("remaining", 1_400_000)), ViolationReason.STATE_MISMATCH);
        assertRejected(cyc, changed(cycle().get(16), p -> p.put("remaining", 1)), ViolationReason.STATE_MISMATCH);   // CLOSED인데 잔액
    }

    @Test
    void anUnknownAgentStatusIsStateMismatch() {
        ObjectNode snapshot = (ObjectNode) Envelopes.JSON.readTree("""
                {"eventId":"5eed0000-0000-4000-8000-0000000000a1","seq":1,"type":"AgentSnapshot","version":1,"occurredAt":"2026-08-01T09:00:00+09:00",
                 "aggregate":{"kind":"AGENT","id":"A-1001"},"payload":{"agentId":"A-1001","name":"허구설계사","orgPath":"/HQ/BR/TM","status":"RETIRED",
                 "validFrom":"2026-08-01"}}""");
        assertRejected(after(a1(), 0), snapshot, ViolationReason.STATE_MISMATCH);
        Rig rig = after(a1(), 0);
        rig.apply(changed(snapshot, p -> p.put("status", "ACTIVE")));
        assertThat(rig.store().agents()).singleElement().satisfies(a -> {
            assertThat(a.role()).as("D-8: no role → NULL").isEmpty();
            assertThat(a.grade()).isEmpty();
        });
    }
}
