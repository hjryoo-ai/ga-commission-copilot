package com.ga.portal.projection;

import com.ga.portal.domain.CommType;
import com.ga.portal.domain.MonthEvent;
import com.ga.portal.domain.MonthStatus;
import com.ga.portal.domain.MonthTransitions;
import com.ga.portal.domain.ViolationReason;
import com.ga.portal.domain.view.LedgerRow;
import com.ga.portal.domain.view.LineRow;
import com.ga.portal.domain.view.MonthRow;
import com.ga.portal.domain.view.MonthSums;
import com.ga.portal.projection.view.ViewStore;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

import java.util.Optional;

/**
 * 라인 두 종(Phase 2 계획 ②): {@code CommissionCalculated}(키 calcId)·{@code AdjustmentPosted}(키 {@code "ADJ:" + adjId}, D-5) →
 * {@code earnings_line} insert, 그 달 {@code earnings_month} 합 갱신(정수 합산만), 삭감 라인이면 원장의 {@code cut_total}·{@code deferred_total}
 * (D-7). 검사: 키 중복(Q4), 마감월(D-4), 월 합 = Σ 라인(D-13 — 그 설계사·그 달 집계 한 번).
 */
final class EarningsProjector {

    static final String ADJUSTMENT_PREFIX = "ADJ:";

    private EarningsProjector() {
    }

    static Change.LineAdded calculated(ViewStore store, Envelope e) {
        Payload p = new Payload(e.payload());
        String calcId = p.str("calcId");
        if (store.line(calcId).isPresent()) {
            throw Projection.violation(ViolationReason.DUPLICATE_KEY, e, "calcId");
        }
        LineRow line = new LineRow(calcId, p.str("agentId"), p.str("policyNo"), p.optStr("productKey"), p.str("commType"), p.lng("amount"),
                p.str("closeYm"), p.optStr("reversalOfCalcId"), p.lng("limitCutAmt"), p.optStr("limitCutPolicy"), p.json("basis"),
                p.json("policySummary"), e.seq());
        addLine(store, e, line);
        if (line.limitCutAmt() > 0) {
            LedgerRow ledger = store.ledgerOf(line.policyNo(), line.agentId())
                    .orElseThrow(() -> Projection.violation(ViolationReason.UNKNOWN_REFERENCE, e, "ledger of a cut line"));
            String policy = line.limitCutPolicy().orElseThrow(() -> Projection.violation(ViolationReason.STATE_MISMATCH, e, "cut without policy"));
            store.saveLedger(switch (policy) {
                case "CUT" -> ledger.cut(line.limitCutAmt(), 0);
                case "DEFER_AFTER_FY" -> ledger.cut(0, line.limitCutAmt());
                default -> throw Projection.violation(ViolationReason.STATE_MISMATCH, e, "cut policy");
            });
        }
        return new Change.LineAdded(line);
    }

    static void adjusted(ViewStore store, Envelope e) {
        Payload p = new Payload(e.payload());
        String calcId = ADJUSTMENT_PREFIX + p.str("adjId");
        if (store.line(calcId).isPresent()) {
            throw Projection.violation(ViolationReason.DUPLICATE_KEY, e, "adjId");
        }
        LineRow target = store.line(p.str("targetCalcId"))
                .orElseThrow(() -> Projection.violation(ViolationReason.UNKNOWN_REFERENCE, e, "targetCalcId"));
        if (!target.agentId().equals(p.str("agentId"))) {
            throw Projection.violation(ViolationReason.STATE_MISMATCH, e, "targetCalcId agent");
        }
        ObjectNode basis = JsonNodeFactory.instance.objectNode();
        basis.put("targetCalcId", p.str("targetCalcId"));
        basis.put("reason", p.str("reason"));   // 엔진 자유 문자열(정정 사유) — 로그·예외에는 쓰지 않는다
        addLine(store, e, new LineRow(calcId, p.str("agentId"), target.policyNo(), target.productKey(), CommType.ADJUSTMENT.value(),
                p.lng("amount"), p.str("closeYm"), Optional.empty(), 0, Optional.empty(), basis.toString(), target.policySummary(), e.seq()));
    }

    private static void addLine(ViewStore store, Envelope e, LineRow line) {
        Optional<MonthRow> month = store.month(line.agentId(), line.closeYm());
        MonthStatus next = Projection.accept(MonthTransitions.next(month.map(MonthRow::status), MonthEvent.LINE), e, "month");
        store.insertLine(line);
        MonthRow current = month.orElseGet(() -> MonthRow.first(line.agentId(), line.closeYm(), next, e.seq()));
        MonthSums s = current.sums();
        CommType type = CommType.of(line.commType());
        MonthSums added = type.isClawback() ? new MonthSums(s.gross(), s.clawbackOffset() + line.amount(), s.adjustment())
                : type.isAdjustment() ? new MonthSums(s.gross(), s.clawbackOffset(), s.adjustment() + line.amount())
                : new MonthSums(s.gross() + line.amount(), s.clawbackOffset(), s.adjustment());
        MonthRow updated = current.withSums(added).withStatus(next, e.seq());
        store.saveMonth(updated);
        if (!store.monthSums(line.agentId(), line.closeYm()).equals(updated.sums())) {
            throw Projection.violation(ViolationReason.SUM_MISMATCH, e, "month sums");
        }
    }
}
