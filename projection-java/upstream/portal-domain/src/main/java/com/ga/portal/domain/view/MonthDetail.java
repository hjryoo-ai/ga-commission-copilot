package com.ga.portal.domain.view;

import com.ga.portal.domain.MonthStatus;
import com.ga.portal.domain.NetBasis;

import java.util.Objects;
import java.util.Optional;

/**
 * 월 상세의 행 + 지난달 행의 값(포털 Phase 5 CR-1 — 같은 문장의 {@code LEFT JOIN}). 지난달 행이 없으면 {@code previous}가 비어 있다. 두 달의 값은 각자의 상태
 * 그대로이고 포털은 차감하지 않는다(화면이 나란히 보인다).
 */
public record MonthDetail(MonthRow row, Optional<Previous> previous) {

    public MonthDetail {
        Objects.requireNonNull(row, "row");
        Objects.requireNonNull(previous, "previous");
    }

    public record Previous(String closeYm, MonthStatus status, long gross, Optional<Long> net, Optional<NetBasis> netBasis) {
        public Previous {
            Objects.requireNonNull(closeYm, "closeYm");
            Objects.requireNonNull(status, "status");
            Objects.requireNonNull(net, "net");
            Objects.requireNonNull(netBasis, "netBasis");
        }
    }
}
