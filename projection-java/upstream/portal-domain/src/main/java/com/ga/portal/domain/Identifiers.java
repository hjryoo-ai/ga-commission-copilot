package com.ga.portal.domain;

import java.util.Objects;

/**
 * 엔진이 발급한 식별자 문자열(계산·증권·원장·분급 스케줄)의 공통 검증. 포털은 이 값을 만들지 않고 받기만 한다 —
 * 형식은 엔진 소관이므로 여기서는 저장·표시가 안전한 최소 조건만 본다: 1~64자, 앞뒤 공백 없음, 제어 문자 없음.
 */
final class Identifiers {

    static final int MAX_LENGTH = 64;

    private Identifiers() {
    }

    static String require(String kind, String value) {
        Objects.requireNonNull(value, kind + " must not be null");
        if (value.isEmpty() || value.length() > MAX_LENGTH) {
            throw new IllegalArgumentException(kind + " must be 1.." + MAX_LENGTH + " characters, was " + value.length());
        }
        if (!value.equals(value.strip())) {
            throw new IllegalArgumentException(kind + " must not have leading or trailing whitespace");
        }
        if (value.codePoints().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException(kind + " must not contain control characters");
        }
        return value;
    }
}
