package com.ga.portal.domain.access;

/** 쿼리 파라미터 형식·범위 오류 — 응답은 400 {@code INVALID_REQUEST} 한 가지(계획 Q11, 사유 없음). 메시지에 입력값을 싣지 않는다. */
public final class InvalidRequest extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public InvalidRequest(String rule) {
        super(rule, null, false, false);
    }
}
