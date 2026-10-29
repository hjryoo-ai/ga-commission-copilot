package com.ga.portal.domain.view;

import java.util.Objects;
import java.util.Optional;

/**
 * 라인 한 줄(목록·상세 공통). {@code policyNo}는 응답에 싣지 않는다 — 유스케이스가 {@code policyMasked}·{@code policyKey}로 바꾼다. {@code reversedBy}는 이 라인을
 * 취소한 라인(같은 설계사의 {@code reversal_of_calc_id = calc_id}, 문장 안의 부분 질의). {@code reversalOfYm}·{@code reversedByYm}은 그 짝의 마감월
 * (포털 Phase 5 CR-2 — 같은 문장의 부분 질의).
 */
public record LineItem(String calcId, String closeYm, String commType, long amount, long limitCutAmt, Optional<String> limitCutPolicy,
                       Optional<String> productKey, Optional<String> productName, Optional<String> insuredMasked, String policyNo,
                       Optional<String> reversalOf, Optional<String> reversedBy, Optional<String> reversalOfYm, Optional<String> reversedByYm,
                       long sourceSeq) {
    public LineItem {
        Objects.requireNonNull(calcId, "calcId");
        Objects.requireNonNull(policyNo, "policyNo");
    }
}
