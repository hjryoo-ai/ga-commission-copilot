package com.ga.portal.projection.notify;

import com.ga.portal.domain.NotificationType;
import com.ga.portal.domain.Severity;
import com.ga.portal.domain.notify.NotificationParams;
import com.ga.portal.domain.notify.NotificationShapes;

import java.util.Objects;
import java.util.Optional;

/**
 * 알림 후보 하나 — 수신 설계사·종류·중복 키·{@code params}. 심각도는 종류가, 화면 경로는 {@code params}가 정한다({@link NotificationShapes}). 증권번호 원문은
 * 어디에도 없다({@code params}에는 가린 값만, 키에는 원장·라인·분급·이벤트·달의 ID만).
 */
public record Candidate(String agentId, NotificationType type, String dedupKey, NotificationParams params) {

    public Candidate {
        Objects.requireNonNull(agentId, "agentId");
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(dedupKey, "dedupKey");
        Objects.requireNonNull(params, "params");
        if (!NotificationShapes.fits(type, params)) {
            throw new IllegalArgumentException("params do not fit " + type);
        }
    }

    public Severity severity() {
        return type.severity();
    }

    public Optional<String> link() {
        return NotificationShapes.link(params);
    }
}
