package com.ga.portal.domain.view;

import java.time.LocalDate;
import java.util.Objects;

/**
 * {@code policy_limit} 한 행. {@code limitMultiple}은 엔진이 준 불투명 소수 문자열이다 — 포털은 곱하지 않고 숫자로 바꾸지 않는다
 * (V5부터 {@code TEXT} 원문 그대로 저장·반환). {@code accumPaid}는 엔진 {@code accumAfter} 그대로다.
 */
public record LedgerRow(String ledgerId, String agentId, String policyNo, LocalDate contractDate, LocalDate fyStart, LocalDate fyEnd,
                        long monthlyPremium, String limitMultiple, long limitAmount, long accumPaid, long cutTotal, long deferredTotal,
                        long lastPostingSeq, String ruleVersionId) {

    public LedgerRow {
        Objects.requireNonNull(ledgerId, "ledgerId");
        Objects.requireNonNull(agentId, "agentId");
        Objects.requireNonNull(policyNo, "policyNo");
        Objects.requireNonNull(contractDate, "contractDate");
        Objects.requireNonNull(fyStart, "fyStart");
        Objects.requireNonNull(fyEnd, "fyEnd");
        Objects.requireNonNull(limitMultiple, "limitMultiple");
        Objects.requireNonNull(ruleVersionId, "ruleVersionId");
    }

    public LedgerRow posted(long accumAfter, long postingSeq) {
        return new LedgerRow(ledgerId, agentId, policyNo, contractDate, fyStart, fyEnd, monthlyPremium, limitMultiple, limitAmount, accumAfter,
                cutTotal, deferredTotal, postingSeq, ruleVersionId);
    }

    public LedgerRow rebased(long newLimit, long newMonthlyPremium) {
        return new LedgerRow(ledgerId, agentId, policyNo, contractDate, fyStart, fyEnd, newMonthlyPremium, limitMultiple, newLimit, accumPaid,
                cutTotal, deferredTotal, lastPostingSeq, ruleVersionId);
    }

    public LedgerRow cut(long cut, long deferred) {
        return new LedgerRow(ledgerId, agentId, policyNo, contractDate, fyStart, fyEnd, monthlyPremium, limitMultiple, limitAmount, accumPaid,
                cutTotal + cut, deferredTotal + deferred, lastPostingSeq, ruleVersionId);
    }
}
