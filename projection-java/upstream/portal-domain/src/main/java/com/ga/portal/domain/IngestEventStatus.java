package com.ga.portal.domain;

/**
 * {@code ingest_event.status}(설계서 §5). {@code SKIPPED}는 V1의 닫힌 값에 있으나 쓰지 않는다 — 건너뛴 이벤트는 행을 남기지 않고
 * 지표로만 센다(Phase 1 계획 승인 Q2: 같은 eventId의 행이 이미 있어 PK상 두 번째 행이 불가능하다).
 */
public enum IngestEventStatus {
    APPLIED,
    /** 미사용(Phase 1 Q2). */
    SKIPPED,
    FAILED
}
