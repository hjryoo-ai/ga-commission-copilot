package com.ga.portal.domain;

/** 분급 스케줄 항목 식별자 — deferral_item의 키. */
public record ScheduleId(String value) {

    public ScheduleId {
        Identifiers.require("ScheduleId", value);
    }

    public static ScheduleId of(String value) {
        return new ScheduleId(value);
    }

    @Override
    public String toString() {
        return value;
    }
}
