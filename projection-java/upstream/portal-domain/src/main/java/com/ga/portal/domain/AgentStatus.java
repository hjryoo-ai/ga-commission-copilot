package com.ga.portal.domain;

/** 설계사 상태(설계서 §5 {@code agent_profile.status}, 계약 {@code AgentSnapshot.status} — 엔진은 기준일 해촉 여부로 두 값만 낸다). */
public enum AgentStatus {
    ACTIVE,
    /** 해촉. */
    DISMISSED
}
