package com.ga.portal.projection;

import com.ga.portal.domain.AgentStatus;
import com.ga.portal.domain.ViolationReason;
import com.ga.portal.domain.view.AgentRow;
import com.ga.portal.projection.view.ViewStore;

import java.util.Arrays;

/** {@code AgentSnapshot} → {@code agent_profile} upsert(지시문 D-8 — 역할이 없으면 NULL, 조직 경로는 엔진 문자열 그대로). */
final class AgentProjector {

    private AgentProjector() {
    }

    static void snapshot(ViewStore store, Envelope e) {
        Payload p = new Payload(e.payload());
        String status = p.str("status");
        if (Arrays.stream(AgentStatus.values()).noneMatch(s -> s.name().equals(status))) {
            throw Projection.violation(ViolationReason.STATE_MISMATCH, e, "agent status");
        }
        // nameMasked는 버린다 — 표시 시점 마스킹(설계서 §14.1 #5)
        store.saveAgent(new AgentRow(p.str("agentId"), p.str("name"), p.optStr("grade"), p.str("orgPath"), p.optStr("role"),
                AgentStatus.valueOf(status), p.date("validFrom"), e.seq()));
    }
}
