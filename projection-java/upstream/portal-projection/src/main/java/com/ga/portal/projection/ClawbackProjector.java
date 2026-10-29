package com.ga.portal.projection;

import com.ga.portal.domain.ReceivableStatus;
import com.ga.portal.domain.ReceivableTransitions;
import com.ga.portal.domain.view.ReceivableRow;
import com.ga.portal.projection.view.ViewStore;

/** 환수 채권(Phase 2 계획 ②, ① E-6): {@code clawback_item} upsert — 엔진 채권 불변식을 어기는 갱신은 독. */
final class ClawbackProjector {

    private ClawbackProjector() {
    }

    static void updated(ViewStore store, Envelope e) {
        Payload p = new Payload(e.payload());
        ReceivableTransitions.Receivable incoming = new ReceivableTransitions.Receivable(p.str("agentId"), p.str("originCalcId"),
                p.lng("amount"), p.lng("remaining"), ReceivableStatus.valueOf(p.str("status")));
        String id = p.str("receivableId");
        ReceivableStatus status = Projection.accept(ReceivableTransitions.next(store.receivable(id).map(r ->
                new ReceivableTransitions.Receivable(r.agentId(), r.originCalcId(), r.amount(), r.remaining(), r.status())), incoming), e, "receivable");
        store.saveReceivable(new ReceivableRow(id, incoming.agentId(), incoming.originCalcId(), incoming.amount(), incoming.remaining(), status,
                e.seq()));
    }
}
