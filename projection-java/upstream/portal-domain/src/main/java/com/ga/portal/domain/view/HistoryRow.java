package com.ga.portal.domain.view;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;

/** {@code policy_limit_history} 한 행 — 키는 그 사실의 이벤트 {@code seq}(v1.5, DD-5). {@code kind} = POST/REBASE. */
public record HistoryRow(String ledgerId, long sourceSeq, Optional<Long> postingSeq, String kind, Optional<String> calcId, Optional<Long> amount,
                         long accumAfter, long limitAfter, Optional<String> reason, Instant occurredAt) {

    public HistoryRow {
        Objects.requireNonNull(ledgerId, "ledgerId");
        Objects.requireNonNull(postingSeq, "postingSeq");
        Objects.requireNonNull(kind, "kind");
        Objects.requireNonNull(calcId, "calcId");
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(reason, "reason");
        Objects.requireNonNull(occurredAt, "occurredAt");
    }
}
