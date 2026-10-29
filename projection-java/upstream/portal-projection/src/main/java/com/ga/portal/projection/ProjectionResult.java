package com.ga.portal.projection;

import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * 프로젝터 적용 결과 — 알림 파생(Phase 6)과 지표의 입력.
 *
 * @param appliedTo 쓴 뷰 테이블 이름들(기록 프로젝터는 비어 있다)
 * @param drift     마감·지급 이벤트의 합계가 포털 합산과 달랐다(지시문 D-3 — 독이 아니라 그 달 DRIFT, 지표 {@code projection_drift_total})
 * @param change    이 이벤트로 바뀐 것(포털 Phase 6 — 파생 규칙의 입력, 변이가 없는 이벤트는 비어 있다)
 */
public record ProjectionResult(List<String> appliedTo, boolean drift, Optional<Change> change) {

    public ProjectionResult {
        appliedTo = List.copyOf(appliedTo);
        Objects.requireNonNull(change, "change");
    }

    public ProjectionResult(List<String> appliedTo, boolean drift) {
        this(appliedTo, drift, Optional.empty());
    }

    public static ProjectionResult of(List<String> appliedTo) {
        return new ProjectionResult(appliedTo, false);
    }

    public static ProjectionResult of(List<String> appliedTo, Change change) {
        return new ProjectionResult(appliedTo, false, Optional.of(change));
    }

    public static ProjectionResult recordedOnly() {
        return new ProjectionResult(List.of(), false);
    }
}
