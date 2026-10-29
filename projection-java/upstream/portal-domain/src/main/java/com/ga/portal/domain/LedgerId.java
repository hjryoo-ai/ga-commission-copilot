package com.ga.portal.domain;

/** 1200% 한도 원장 식별자 — policy_limit의 키. */
public record LedgerId(String value) {

    public LedgerId {
        Identifiers.require("LedgerId", value);
    }

    public static LedgerId of(String value) {
        return new LedgerId(value);
    }

    @Override
    public String toString() {
        return value;
    }
}
