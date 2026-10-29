package com.ga.portal.domain;

/** 증권번호 — 저장은 하되 화면은 뒷자리 일부만 표시한다(설계서 §9). */
public record PolicyNo(String value) {

    public PolicyNo {
        Identifiers.require("PolicyNo", value);
    }

    public static PolicyNo of(String value) {
        return new PolicyNo(value);
    }

    @Override
    public String toString() {
        return value;
    }
}
