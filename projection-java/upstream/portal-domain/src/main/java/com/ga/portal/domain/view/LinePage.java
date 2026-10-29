package com.ga.portal.domain.view;

import java.util.List;

/** 라인 한 페이지(정렬 {@code source_seq, calc_id}) + 필터에 맞는 전체 수. */
public record LinePage(List<LineItem> items, long total) {
    public LinePage {
        items = List.copyOf(items);
    }
}
