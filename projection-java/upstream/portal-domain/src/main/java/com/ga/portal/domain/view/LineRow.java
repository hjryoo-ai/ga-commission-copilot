package com.ga.portal.domain.view;

import java.util.Objects;
import java.util.Optional;

/**
 * {@code earnings_line} 한 행 — {@code CommissionCalculated}(키 {@code calcId}) 또는 {@code AdjustmentPosted}(키 {@code "ADJ:" + adjId},
 * 지시문 D-5). {@code amount}는 한도 삭감 뒤 지급분이다(요청액 = amount + limitCutAmt). {@code basis}·{@code policySummary}는 JSON 텍스트.
 */
public record LineRow(String calcId, String agentId, String policyNo, Optional<String> productKey, String commType, long amount,
                      String closeYm, Optional<String> reversalOfCalcId, long limitCutAmt, Optional<String> limitCutPolicy, String basis,
                      String policySummary, long sourceSeq) {

    public LineRow {
        Objects.requireNonNull(calcId, "calcId");
        Objects.requireNonNull(agentId, "agentId");
        Objects.requireNonNull(policyNo, "policyNo");
        Objects.requireNonNull(productKey, "productKey");
        Objects.requireNonNull(commType, "commType");
        Objects.requireNonNull(closeYm, "closeYm");
        Objects.requireNonNull(reversalOfCalcId, "reversalOfCalcId");
        Objects.requireNonNull(limitCutPolicy, "limitCutPolicy");
        Objects.requireNonNull(basis, "basis");
        Objects.requireNonNull(policySummary, "policySummary");
    }
}
