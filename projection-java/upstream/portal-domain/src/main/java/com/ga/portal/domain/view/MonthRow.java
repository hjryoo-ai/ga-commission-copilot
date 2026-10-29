package com.ga.portal.domain.view;

import com.ga.portal.domain.DataStatus;
import com.ga.portal.domain.MonthStatus;
import com.ga.portal.domain.NetBasis;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;

/**
 * {@code earnings_month} 한 행(설계서 §5 v1.5, 지시문 D-2). 세 합계는 포털 합산이고({@link MonthSums}), 세후·지급 확정값은 엔진 값을 그대로 담는다.
 * 고치는 메서드({@code with…})는 새 행을 돌려준다.
 */
public record MonthRow(String agentId, String closeYm, long gross, long clawbackOffset, long adjustment, Optional<Long> withholdingTax,
                       Optional<Long> net, MonthStatus status, DataStatus dataStatus, Optional<Instant> estimateAsOf,
                       Optional<Long> estimateBasisSeq, Optional<Instant> confirmedAt, Optional<Instant> paidAt, Optional<Long> paidAmount,
                       Optional<Long> receivableOffset, Optional<Long> carriedReceivable, Optional<Long> payable, Optional<Long> runSeq,
                       Optional<NetBasis> netBasis, long lastSeq) {

    public MonthRow {
        Objects.requireNonNull(agentId, "agentId");
        Objects.requireNonNull(closeYm, "closeYm");
        Objects.requireNonNull(withholdingTax, "withholdingTax");
        Objects.requireNonNull(net, "net");
        Objects.requireNonNull(status, "status");
        Objects.requireNonNull(dataStatus, "dataStatus");
        Objects.requireNonNull(estimateAsOf, "estimateAsOf");
        Objects.requireNonNull(estimateBasisSeq, "estimateBasisSeq");
        Objects.requireNonNull(confirmedAt, "confirmedAt");
        Objects.requireNonNull(paidAt, "paidAt");
        Objects.requireNonNull(paidAmount, "paidAmount");
        Objects.requireNonNull(receivableOffset, "receivableOffset");
        Objects.requireNonNull(carriedReceivable, "carriedReceivable");
        Objects.requireNonNull(payable, "payable");
        Objects.requireNonNull(runSeq, "runSeq");
        Objects.requireNonNull(netBasis, "netBasis");
    }

    /** 그 달의 첫 행 — 합 0, 세후 없음, 상태는 첫 사건이 정한다. */
    public static MonthRow first(String agentId, String closeYm, MonthStatus status, long seq) {
        return new MonthRow(agentId, closeYm, 0, 0, 0, Optional.empty(), Optional.empty(), status, DataStatus.OK, Optional.empty(),
                Optional.empty(), Optional.empty(), Optional.empty(), Optional.empty(), Optional.empty(), Optional.empty(), Optional.empty(),
                Optional.empty(), Optional.empty(), seq);
    }

    public MonthSums sums() {
        return new MonthSums(gross, clawbackOffset, adjustment);
    }

    public MonthRow withSums(MonthSums s) {
        return new MonthRow(agentId, closeYm, s.gross(), s.clawbackOffset(), s.adjustment(), withholdingTax, net, status, dataStatus,
                estimateAsOf, estimateBasisSeq, confirmedAt, paidAt, paidAmount, receivableOffset, carriedReceivable, payable, runSeq, netBasis,
                lastSeq);
    }

    public MonthRow withStatus(MonthStatus s, long seq) {
        return new MonthRow(agentId, closeYm, gross, clawbackOffset, adjustment, withholdingTax, net, s, dataStatus, estimateAsOf,
                estimateBasisSeq, confirmedAt, paidAt, paidAmount, receivableOffset, carriedReceivable, payable, runSeq, netBasis, seq);
    }

    public MonthRow withNet(Optional<Long> tax, Optional<Long> netAmount, NetBasis basis) {
        if (tax.isEmpty() && netAmount.isEmpty()) {
            return this;
        }
        return new MonthRow(agentId, closeYm, gross, clawbackOffset, adjustment, tax.or(() -> withholdingTax), netAmount.or(() -> net), status,
                dataStatus, estimateAsOf, estimateBasisSeq, confirmedAt, paidAt, paidAmount, receivableOffset, carriedReceivable, payable, runSeq,
                Optional.of(basis), lastSeq);
    }

    public MonthRow withEstimate(Instant asOf, long basisSeq) {
        return new MonthRow(agentId, closeYm, gross, clawbackOffset, adjustment, withholdingTax, net, status, dataStatus, Optional.of(asOf),
                Optional.of(basisSeq), confirmedAt, paidAt, paidAmount, receivableOffset, carriedReceivable, payable, runSeq, netBasis, lastSeq);
    }

    public MonthRow withConfirmedAt(Instant at) {
        return new MonthRow(agentId, closeYm, gross, clawbackOffset, adjustment, withholdingTax, net, status, dataStatus, estimateAsOf,
                estimateBasisSeq, Optional.of(at), paidAt, paidAmount, receivableOffset, carriedReceivable, payable, runSeq, netBasis, lastSeq);
    }

    public MonthRow withPayout(Instant at, long amount, Optional<Long> receivableOff, Optional<Long> carried, Optional<Long> payableAmount,
                               Optional<Long> run) {
        return new MonthRow(agentId, closeYm, gross, clawbackOffset, adjustment, withholdingTax, net, status, dataStatus, estimateAsOf,
                estimateBasisSeq, confirmedAt, Optional.of(at), Optional.of(amount), receivableOff, carried, payableAmount, run, netBasis, lastSeq);
    }

    public MonthRow withDataStatus(DataStatus s) {
        return new MonthRow(agentId, closeYm, gross, clawbackOffset, adjustment, withholdingTax, net, status, s, estimateAsOf, estimateBasisSeq,
                confirmedAt, paidAt, paidAmount, receivableOffset, carriedReceivable, payable, runSeq, netBasis, lastSeq);
    }
}
