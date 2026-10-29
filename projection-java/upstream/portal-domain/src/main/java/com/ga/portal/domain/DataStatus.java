package com.ga.portal.domain;

/**
 * 월 데이터의 신뢰 상태(설계서 §5 {@code earnings_month.data_status}, §6.6). 응답의 {@code SYNC_DELAYED}는 인제스트 커서 상태에서 나오는
 * 응답 값이라 여기 없다(계획 I2 — Phase 3 응답 타입).
 */
public enum DataStatus {
    OK,
    /** 대사 불일치 — 화면은 "확인 중", 금액을 흐리게. */
    DRIFT,
    /** 재구축 중. */
    REBUILDING
}
