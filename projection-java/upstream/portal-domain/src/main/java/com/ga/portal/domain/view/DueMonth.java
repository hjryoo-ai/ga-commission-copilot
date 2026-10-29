package com.ga.portal.domain.view;

/** 분급 지급 예정월 하나(설계서 §6.4): {@code expected} = Σ SCHEDULED + RELEASED, {@code held} = Σ HELD — SQL의 정수 합. */
public record DueMonth(String dueYm, long expected, long held) {
}
