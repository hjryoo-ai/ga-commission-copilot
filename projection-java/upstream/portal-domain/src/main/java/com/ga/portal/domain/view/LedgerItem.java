package com.ga.portal.domain.view;


import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * 한도 원장 하나 + 남은 한도(SQL의 정수 차감 {@code limit_amount − accum_paid}) + 열린 플래그 유형(정렬, 같은 문장의 집계) + 그 계약의 첫 라인의 상품·피보험자
 * (포털 Phase 5 CR-4 — 원장 이벤트에는 상품이 없다, 같은 문장의 부분 질의).
 */
public record LedgerItem(LedgerRow ledger, long remaining, List<String> openFlags, Optional<String> productKey, Optional<String> productName,
                         Optional<String> insuredMasked) {
    public LedgerItem {
        Objects.requireNonNull(ledger, "ledger");
        openFlags = List.copyOf(openFlags);
        Objects.requireNonNull(productKey, "productKey");
        Objects.requireNonNull(productName, "productName");
        Objects.requireNonNull(insuredMasked, "insuredMasked");
    }
}
