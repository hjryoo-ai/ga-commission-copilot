package com.ga.portal.projection;

import com.ga.portal.domain.ViolationReason;
import com.ga.portal.domain.view.HistoryRow;
import com.ga.portal.domain.view.LedgerRow;
import com.ga.portal.projection.view.ViewStore;

import java.util.Optional;

/**
 * 한도 원장(Phase 2 계획 ②): 개설 → {@code policy_limit} insert, 전기·재산정 → 원장 갱신 + {@code policy_limit_history}(키 = 이벤트 seq).
 * 전기는 그 {@code calcId}의 라인을 <b>요구하지 않는다</b>(지시문 D-6 — 순서 역전). 검사는 엔진 원장 규칙 그대로(승인 Q5·Q6):
 * 순번 = 직전 + 1, {@code accum_after − 누적 = amount}, 양수 전기 뒤 누적 ≤ 한도, 누적 ≥ 0, 재산정은 {@code oldLimit}·순번 대조만.
 * 전기·재산정은 읽은 행과 저장한 행을 {@link Change}로 돌려준다(포털 Phase 6 — 알림 파생).
 */
final class LimitProjector {

    private LimitProjector() {
    }

    static void opened(ViewStore store, Envelope e) {
        Payload p = new Payload(e.payload());
        if (store.ledger(p.str("ledgerId")).isPresent() || store.ledgerOf(p.str("policyNo"), p.str("agentId")).isPresent()) {
            throw Projection.violation(ViolationReason.DUPLICATE_KEY, e, "ledgerId");
        }
        store.insertLedger(new LedgerRow(p.str("ledgerId"), p.str("agentId"), p.str("policyNo"), p.date("contractDate"), p.date("fyStart"),
                p.date("fyEnd"), p.lng("monthlyPremium"), p.str("limitMultiple"), p.lng("limitAmount"), 0, 0, 0, 0, p.str("ruleVersionId")));
    }

    static Change.LedgerPosted posted(ViewStore store, Envelope e) {
        Payload p = new Payload(e.payload());
        LedgerRow ledger = store.ledger(p.str("ledgerId")).orElseThrow(() -> Projection.violation(ViolationReason.UNKNOWN_REFERENCE, e, "ledgerId"));
        long postingSeq = p.lng("postingSeq");
        long amount = p.lng("amount");
        long accumAfter = p.lng("accumAfter");
        if (postingSeq != ledger.lastPostingSeq() + 1) {
            throw Projection.violation(ViolationReason.STATE_MISMATCH, e, "postingSeq");
        }
        if (accumAfter - ledger.accumPaid() != amount) {
            throw Projection.violation(ViolationReason.ACCUM_CHAIN, e, "accumAfter");
        }
        if (amount > 0 && accumAfter > ledger.limitAmount()) {
            throw Projection.violation(ViolationReason.OVER_LIMIT, e, "accumAfter");
        }
        if (accumAfter < 0) {
            throw Projection.violation(ViolationReason.NEGATIVE_ACCUM, e, "accumAfter");
        }
        LedgerRow after = ledger.posted(accumAfter, postingSeq);
        store.saveLedger(after);
        store.insertHistory(new HistoryRow(ledger.ledgerId(), e.seq(), Optional.of(postingSeq), "POST", Optional.of(p.str("calcId")),
                Optional.of(amount), accumAfter, ledger.limitAmount(), Optional.empty(), e.occurredAtTime().toInstant()));
        return new Change.LedgerPosted(ledger, after);
    }

    static Change.LedgerRebased rebased(ViewStore store, Envelope e) {
        Payload p = new Payload(e.payload());
        LedgerRow ledger = store.ledger(p.str("ledgerId")).orElseThrow(() -> Projection.violation(ViolationReason.UNKNOWN_REFERENCE, e, "ledgerId"));
        if (p.lng("oldLimit") != ledger.limitAmount()) {
            throw Projection.violation(ViolationReason.STATE_MISMATCH, e, "oldLimit");
        }
        Optional<Long> postingSeq = p.optLng("postingSeq");
        if (postingSeq.isPresent() && postingSeq.get() != ledger.lastPostingSeq()) {
            throw Projection.violation(ViolationReason.STATE_MISMATCH, e, "postingSeq");
        }
        long newLimit = p.lng("newLimit");
        LedgerRow after = ledger.rebased(newLimit, p.lng("monthlyPremium"));
        store.saveLedger(after);
        store.insertHistory(new HistoryRow(ledger.ledgerId(), e.seq(), postingSeq, "REBASE", Optional.empty(), Optional.empty(),
                ledger.accumPaid(), newLimit, Optional.of(p.str("reason")), e.occurredAtTime().toInstant()));
        return new Change.LedgerRebased(ledger, after);
    }
}
