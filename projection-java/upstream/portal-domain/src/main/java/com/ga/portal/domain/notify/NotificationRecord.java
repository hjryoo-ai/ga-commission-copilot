package com.ga.portal.domain.notify;

import com.ga.portal.domain.NotificationType;
import com.ga.portal.domain.Severity;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * {@code notification} 행(테넌트 열 제외, V7). {@code dedupKey}는 DB 안에만 있다 — 응답에 없다(C5). 키는 이름 기반 UUID
 * ({@code 테넌트 ∥ U+001F ∥ 설계사 ∥ U+001F ∥ dedup_key} — 같은 사실은 재시작해도 같은 키, 계획 Q29). 심각도는 종류가 정한다.
 */
public record NotificationRecord(UUID id, String agentId, NotificationType type, String dedupKey, NotificationParams params, Optional<String> link,
                                 Instant createdAt, Optional<Instant> readAt) {

    public NotificationRecord {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(agentId, "agentId");
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(dedupKey, "dedupKey");
        Objects.requireNonNull(params, "params");
        Objects.requireNonNull(link, "link");
        Objects.requireNonNull(createdAt, "createdAt");
        Objects.requireNonNull(readAt, "readAt");
        if (!NotificationShapes.fits(type, params)) {
            throw new IllegalArgumentException("params do not fit " + type);
        }
        if (!link.equals(NotificationShapes.link(params))) {
            throw new IllegalArgumentException("link does not follow the params");
        }
    }

    /** 새 알림 — 키·경로·심각도는 여기서 정해진다. */
    public static NotificationRecord fresh(String tenantId, String agentId, NotificationType type, String dedupKey, NotificationParams params,
                                           Instant createdAt) {
        return new NotificationRecord(id(tenantId, agentId, dedupKey), agentId, type, dedupKey, params, NotificationShapes.link(params), createdAt,
                Optional.empty());
    }

    public static UUID id(String tenantId, String agentId, String dedupKey) {
        return UUID.nameUUIDFromBytes((tenantId + '\u001F' + agentId + '\u001F' + dedupKey).getBytes(StandardCharsets.UTF_8));
    }

    public Severity severity() {
        return type.severity();
    }
}
