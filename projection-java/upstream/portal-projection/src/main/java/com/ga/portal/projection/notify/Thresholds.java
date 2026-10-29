package com.ga.portal.projection.notify;

/**
 * 한도 경고 임계치(정수 bp — 테넌트 설정의 백분율을 SQL이 읽은 값, 조회의 {@code LimitStage}와 같은 재료). 전기({@code LedgerPosted})의 단계 판정에만 쓴다.
 */
public record Thresholds(long warnBp, long critBp) {
}
