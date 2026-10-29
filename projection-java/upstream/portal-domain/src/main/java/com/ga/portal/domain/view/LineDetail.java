package com.ga.portal.domain.view;

import java.util.List;
import java.util.Optional;

/** 라인 상세 — 근거({@code basis}의 불투명 문자열 그대로)와 계약 요약. 날짜는 계약 원문 문자열({@code YYYY-MM-DD}). */
public record LineDetail(LineItem line, Optional<String> rate, Optional<String> payoutRate, Optional<Long> installmentNo, List<String> ruleVersionIds,
                         Optional<String> contractDate, Optional<Long> monthlyPremium) {
    public LineDetail {
        ruleVersionIds = List.copyOf(ruleVersionIds);
    }
}
