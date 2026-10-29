package com.ga.portal.projection;

import com.ga.platform.core.tenant.TenantId;
import com.ga.portal.projection.testing.Envelopes;
import com.ga.portal.projection.testing.GoldenViews;
import com.ga.portal.projection.testing.InMemoryViewStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * C1·C3·C6(Phase 2 지시문 §3): 골든 스트림 → 뷰 9표가 기대 파일과 같다(인메모리 — 같은 파일을 DB로는 ProjectionGoldenIT). 기대 파일은
 * {@code -Pgolden.update=true}로 한 번 쓰고 손계산과 대조했다(보고서). 순서 변형(C3)은 이벤트 seq 열을 뺀 투영이 A-1과 같다.
 */
class ProjectionGoldenTest {

    static final TenantId T = TenantId.of("GA01");

    static Map<String, List<String>> project(Path stream) {
        InMemoryViewStore store = new InMemoryViewStore();
        ViewProjector projector = new ViewProjector(store);
        Envelopes.read(stream).forEach(e -> projector.apply(T, e));
        return GoldenViews.of(store);
    }

    @Test
    void c1TheEngineA1StreamGivesTheGoldenViews() {
        Map<String, List<String>> views = project(Envelopes.a1());
        GoldenViews.assertMatches("a1", views);
        // 손계산(월납 150,000 — 승인 머리말): 8월 gross 1,800,000·지급 1,740,600, 2월 환수 −720,000, 누적 1,080,000, 시책 삭감 145,000은 deferred_total
        assertThat(views.get("earnings_month")).hasSize(2);
        assertThat(views.get("earnings_line")).hasSize(3);
        assertThat(views.get("policy_limit")).singleElement().asString()
                .contains("\"accum_paid\":1080000").contains("\"deferred_total\":145000").contains("\"cut_total\":0");
        // v1.4 둘째 판 seq 11: 202702 잠정 명세(환수만 있는 달 — 세액 0·순액 0, 채권 이월 720,000은 지급 런 열에 넣지 않는다)
        assertThat(views.get("earnings_month")).filteredOn(r -> r.contains("\"close_ym\":\"202702\"")).singleElement().asString()
                .contains("\"status\":\"ESTIMATED\"").contains("\"net_basis\":\"ESTIMATE\"").contains("\"estimate_basis_seq\":10")
                .contains("\"net\":0").contains("\"carried_receivable\":null");
    }

    @ParameterizedTest
    @ValueSource(strings = {"engine-e1-cycle", "engine-e2-estimate/estimate_cycle_01_기본", "engine-e2-estimate/estimate_cycle_02_채권_상계", "engine-e2-estimate/estimate_cycle_03_정정_포함", "engine-e2-estimate/estimate_cycle_04_음수_순액_채권화", "engine-e2-estimate/estimate_cycle_05_분급_도래"})
    void c1OtherGoldenStreams(String stream) {
        GoldenViews.assertMatches(stream, project(Envelopes.stream(stream + ".jsonl")));
    }

    @ParameterizedTest
    @ValueSource(strings = {"a1-interleaved", "a1-posted-first"})
    void c3LineOrdersGiveTheSameViews(String stream) {
        assertThat(GoldenViews.withoutSeqs(project(Envelopes.stream(stream + ".jsonl"))))
                .isEqualTo(GoldenViews.withoutSeqs(project(Envelopes.a1())));
    }

    /** C6: 예상 → 확정(세액 없음 — 예상 값·ESTIMATE 유지) → 지급(지급 런 값·PAYOUT, 네 컬럼). */
    @Test
    void c6TheAfterTaxFollowsEstimateConfirmPayout() {
        InMemoryViewStore store = new InMemoryViewStore();
        ViewProjector projector = new ViewProjector(store);
        List<com.ga.portal.projection.Envelope> events = Envelopes.read(Envelopes.stream("engine-e2-estimate/estimate_cycle_01_기본.jsonl"));
        for (com.ga.portal.projection.Envelope e : events) {
            projector.apply(T, e);
            var month = store.months().stream().filter(m -> m.closeYm().equals("202608")).findFirst();
            switch (e.type()) {
                case "StatementEstimated" -> assertThat(month).hasValueSatisfying(m -> {
                    assertThat(m.status().name()).isEqualTo("ESTIMATED");
                    assertThat(m.withholdingTax()).contains(62_370L);
                    assertThat(m.netBasis().map(Enum::name)).contains("ESTIMATE");
                    assertThat(m.estimateBasisSeq()).contains(3L);
                });
                case "StatementConfirmed" -> assertThat(month).hasValueSatisfying(m -> {
                    assertThat(m.status().name()).isEqualTo("CONFIRMED");
                    assertThat(m.net()).as("kept from the estimate").contains(1_827_630L);
                    assertThat(m.netBasis().map(Enum::name)).as("label: confirmed (after-tax estimated)").contains("ESTIMATE");
                    assertThat(m.payable()).isEmpty();
                });
                case "PayoutCompleted" -> assertThat(month).hasValueSatisfying(m -> {
                    assertThat(m.status().name()).isEqualTo("PAID");
                    assertThat(m.netBasis().map(Enum::name)).contains("PAYOUT");
                    assertThat(m.paidAmount()).contains(1_827_630L);
                    assertThat(m.receivableOffset()).contains(0L);
                    assertThat(m.carriedReceivable()).contains(0L);
                    assertThat(m.payable()).contains(1_890_000L);
                    assertThat(m.runSeq()).contains(1L);
                });
                default -> {
                }
            }
        }
    }
}
