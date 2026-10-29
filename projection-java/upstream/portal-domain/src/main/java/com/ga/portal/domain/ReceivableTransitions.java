package com.ga.portal.domain;

import java.util.Objects;
import java.util.Optional;

/**
 * 환수 채권 갱신 검사(Phase 2 계획 ① E-6 — 엔진 {@code ClawbackReceivable}의 불변식): 잔액 ∈ [0, 원금], CLOSED ⇒ 잔액 0, 갱신은 같은 설계사·
 * 원천 계산·원금이고 잔액이 늘지 않으며, 종결 상태(CLOSED·WRITTEN_OFF) 뒤에는 갱신이 없다. 상계 없이 OPEN → CLOSED도 있다.
 */
public final class ReceivableTransitions {

    /** 채권 한 시점의 모습. */
    public record Receivable(String agentId, String originCalcId, long amount, long remaining, ReceivableStatus status) {
        public Receivable {
            Objects.requireNonNull(agentId, "agentId");
            Objects.requireNonNull(originCalcId, "originCalcId");
            Objects.requireNonNull(status, "status");
        }
    }

    private ReceivableTransitions() {
    }

    public static TransitionVerdict<ReceivableStatus> next(Optional<Receivable> stored, Receivable incoming) {
        if (incoming.remaining() < 0 || incoming.remaining() > incoming.amount()
                || (incoming.status() == ReceivableStatus.CLOSED && incoming.remaining() != 0)) {
            return new TransitionVerdict.Rejected<>(ViolationReason.STATE_MISMATCH);
        }
        if (stored.isPresent()) {
            Receivable s = stored.get();
            if (s.status().isTerminal() || !s.agentId().equals(incoming.agentId()) || !s.originCalcId().equals(incoming.originCalcId())
                    || s.amount() != incoming.amount() || incoming.remaining() > s.remaining()
                    || (incoming.status() == ReceivableStatus.OPEN && s.status() != ReceivableStatus.OPEN)) {
                return new TransitionVerdict.Rejected<>(ViolationReason.STATE_MISMATCH);
            }
        }
        return new TransitionVerdict.Next<>(incoming.status());
    }
}
