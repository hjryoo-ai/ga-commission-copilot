package com.ga.portal.projection;

import com.ga.portal.domain.DataStatus;
import com.ga.portal.domain.MonthEvent;
import com.ga.portal.domain.MonthStatus;
import com.ga.portal.domain.MonthTransitions;
import com.ga.portal.domain.NetBasis;
import com.ga.portal.domain.ReconSource;
import com.ga.portal.domain.view.MonthRow;
import com.ga.portal.domain.view.ReconRow;
import com.ga.portal.projection.view.ViewStore;

import java.util.Optional;

/**
 * 월 명세 세 이벤트(지시문 D-2·D-3·D-14, 계획 ②·③): 예상 → ESTIMATED(세후 예상·기준 seq 기록), 확정 → CONFIRMED(세후가 실려 오면 채운다 —
 * 엔진 v1은 싣지 않는다), 지급 → PAID(지급 런 확정값). 확정·지급의 합계가 포털 합산과 다르면 <b>독이 아니라</b> 그 달 {@code DRIFT}와
 * {@code recon_result(EVENT)} 한 행 — 있는 필드만 대조한다(엔진은 지급에 정정을 싣지 않는다, E-8).
 */
final class StatementProjector {

    /** 확정·지급의 결과 — 저장한 월 행(포털 Phase 6 — 알림 파생)과 이 이벤트가 낸 대사 불일치. */
    record Closed(MonthRow after, boolean drift) {
    }

    private StatementProjector() {
    }

    /** @return 대사 불일치가 있었는가 */
    static boolean estimated(ViewStore store, Envelope e) {
        Payload p = new Payload(e.payload());
        Optional<MonthRow> month = store.month(p.str("agentId"), p.str("closeYm"));
        MonthStatus next = Projection.accept(MonthTransitions.next(month.map(MonthRow::status), MonthEvent.ESTIMATED), e, "month");
        MonthRow row = month.orElseGet(() -> MonthRow.first(p.str("agentId"), p.str("closeYm"), next, e.seq()))
                .withStatus(next, e.seq())
                .withNet(Optional.of(p.lng("withholdingTax")), Optional.of(p.lng("net")), NetBasis.ESTIMATE)
                .withEstimate(p.instant("asOf"), p.lng("basisSeq"));
        store.saveMonth(row);
        return false;
    }

    static Closed confirmed(ViewStore store, Envelope e) {
        Payload p = new Payload(e.payload());
        Optional<MonthRow> month = store.month(p.str("agentId"), p.str("closeYm"));
        MonthStatus next = Projection.accept(MonthTransitions.next(month.map(MonthRow::status), MonthEvent.CONFIRMED), e, "month");
        MonthRow row = month.orElseGet(() -> MonthRow.first(p.str("agentId"), p.str("closeYm"), next, e.seq()))
                .withStatus(next, e.seq())
                .withNet(p.optLng("withholdingTax"), p.optLng("net"), NetBasis.CONFIRM)
                .withConfirmedAt(p.instant("closedAt"));
        return reconcile(store, e, p, row);
    }

    static Closed paid(ViewStore store, Envelope e) {
        Payload p = new Payload(e.payload());
        Optional<MonthRow> month = store.month(p.str("agentId"), p.str("closeYm"));
        MonthStatus next = Projection.accept(MonthTransitions.next(month.map(MonthRow::status), MonthEvent.PAYOUT), e, "month");
        MonthRow row = month.orElseThrow().withStatus(next, e.seq())
                .withNet(p.optLng("withholdingTax"), p.optLng("net"), NetBasis.PAYOUT)
                .withPayout(p.instant("paidAt"), p.lng("paidAmount"), p.optLng("receivableOffset"), p.optLng("carriedReceivable"),
                        p.optLng("payable"), p.optLng("runSeq"));
        return reconcile(store, e, p, row);
    }

    private static Closed reconcile(ViewStore store, Envelope e, Payload p, MonthRow row) {
        Optional<Long> gross = p.optLng("gross");
        Optional<Long> offset = p.optLng("clawbackOffset");
        Optional<Long> adjustment = p.optLng("adjustment");
        boolean drift = gross.filter(v -> v != row.gross()).isPresent() || offset.filter(v -> v != row.clawbackOffset()).isPresent()
                || adjustment.filter(v -> v != row.adjustment()).isPresent();
        if (drift) {
            store.insertReconIfAbsent(new ReconRow(row.agentId(), row.closeYm(), e.occurredAtTime().toInstant(), row.gross(), row.clawbackOffset(),
                    row.adjustment(), gross, offset, adjustment, p.optLng("net"), "DRIFT", ReconSource.EVENT, e.seq()));
        }
        MonthRow after = drift ? row.withDataStatus(DataStatus.DRIFT) : row;
        store.saveMonth(after);
        return new Closed(after, drift);
    }
}
