package com.ga.portal.domain;

/**
 * 프로젝터가 이벤트를 거부하는 사유(Phase 2 계획 ④). 인제스트 사유는 {@link IngestErrorCode#PROJECTOR_ERROR} 하나이고 이 값은 그 detail의
 * 첫 단어다 — 상태 기계는 사유를 보지 않는다. detail에는 키(seq·eventId)만 쓰고 값은 쓰지 않는다.
 */
public enum ViolationReason {
    /** 마감월(CONFIRMED·PAID)을 바꾸려 한다(불변 규약 4, 지시문 D-4). */
    CLOSED_MONTH,
    /** 저장된 상태와 이벤트가 맞지 않는다 — 전이 표 밖, {@code from} 불일치, 순번·한도 대조, 사유 짝. */
    STATE_MISMATCH,
    /** 모르는 원장·스케줄·정정 대상. */
    UNKNOWN_REFERENCE,
    /** 불변 사실의 키가 이미 있다(승인 Q4). */
    DUPLICATE_KEY,
    /** 월 합산 ≠ Σ 라인(D-13). */
    SUM_MISMATCH,
    /** {@code accum_after − 직전 누적 ≠ amount}(D-13). */
    ACCUM_CHAIN,
    /** 양수 전기 뒤 누적이 한도를 넘는다(승인 Q5 — 엔진 규칙). */
    OVER_LIMIT,
    /** 전기 뒤 누적이 음수다. */
    NEGATIVE_ACCUM
}
