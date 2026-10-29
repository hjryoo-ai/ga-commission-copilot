package com.ga.portal.domain;

/** 인제스트 커서 상태를 움직이는 사건(설계서 §6.1 상태 표). 전이 규칙은 {@link IngestTransitions}. */
public enum IngestTrigger {
    /** 이벤트 하나를 적용했다. */
    APPLIED,
    /** 이미 적용한 이벤트를 다시 받았다(같은 eventId·해시·seq). */
    REPLAYED,
    /** 피드에 닿지 못했다(네트워크·5xx·시간 초과·형식 오류) — 상태 불변, 다음 주기에 다시. */
    FEED_UNAVAILABLE,
    /** 데이터 결함으로 정지 — {@link IngestErrorCode#stopsAs()}가 FAILED인 사유. */
    STOP_FAILED,
    /** 설정·판 문제로 멈춤 — {@link IngestErrorCode#stopsAs()}가 PAUSED인 사유. */
    STOP_PAUSED,
    /** 운영자 {@code ingest pause}. */
    OPERATOR_PAUSE,
    /** 운영자 {@code ingest resume}. */
    OPERATOR_RESUME,
    /** 운영자 {@code ingest rebuild}(설계서 §6.7, Phase 2 승인 Q10 — txA). */
    OPERATOR_REBUILD,
    /** 재구축 재생이 커밋됐다(txB). */
    REBUILD_SUCCEEDED,
    /** 재구축 재생이 실패해 롤백됐다(txC — {@link IngestErrorCode#REBUILD_FAILED}). */
    REBUILD_FAILED
}
