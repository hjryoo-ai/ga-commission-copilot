package com.ga.portal.projection;

import com.ga.portal.domain.FlagType;
import com.ga.portal.domain.ViolationReason;
import com.ga.portal.domain.view.FlagRow;
import com.ga.portal.projection.view.ViewStore;

import java.time.Instant;
import java.util.Optional;

/**
 * 계약 이벤트(지시문 D-10): 플래그 유형으로 upsert(해제 뒤 재플래그도 다시 연다, {@code reason} = 원 이벤트 유형), {@code REINSTATE}는 그 계약의
 * 열린 플래그 전부를 이벤트 시각으로 해제한다(열린 것이 없어도 독이 아니다).
 */
final class FlagProjector {

    private FlagProjector() {
    }

    static Change.FlagObserved observed(ViewStore store, Envelope e) {
        Payload p = new Payload(e.payload());
        String policyNo = p.str("policyNo");
        String agentId = p.str("agentId");
        String eventType = p.str("eventType");
        Change.FlagObserved change = new Change.FlagObserved(eventType, policyNo, agentId, p.date("occurredOn"));
        if (eventType.equals("REINSTATE")) {
            Instant at = e.occurredAtTime().toInstant();
            store.flags(policyNo, agentId).stream().filter(FlagRow::isOpen).forEach(f -> store.saveFlag(f.cleared(at)));
            return change;
        }
        FlagType type = FlagType.of(eventType).orElseThrow(() -> Projection.violation(ViolationReason.STATE_MISMATCH, e, "eventType"));
        store.saveFlag(new FlagRow(policyNo, agentId, type, change.occurredOn(), Optional.empty(), Optional.of(eventType)));
        return change;
    }
}
