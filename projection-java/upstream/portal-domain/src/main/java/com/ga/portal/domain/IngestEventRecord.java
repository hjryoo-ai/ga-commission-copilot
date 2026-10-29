package com.ga.portal.domain;

import com.ga.platform.core.tenant.TenantId;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * {@code ingest_event} 행(설계서 §5·§6.1) — 멱등키(tenant, eventId)와 적용 감사. 본문(payload)은 저장하지 않고 정규 해시만 둔다(D-1).
 *
 * @param payloadHash JCS SHA-256 hex 64자 — {@code {type, version, occurredAt, aggregate, payload}}의 정규 바이트
 */
public record IngestEventRecord(TenantId tenantId, String eventId, long seq, String eventType, Instant receivedAt,
                                IngestEventStatus status, Optional<String> error, String payloadHash) {

    private static final Pattern UUID = Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
    private static final Pattern HASH = Pattern.compile("^[0-9a-f]{64}$");

    public IngestEventRecord {
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(eventType, "eventType");
        Objects.requireNonNull(receivedAt, "receivedAt");
        Objects.requireNonNull(status, "status");
        Objects.requireNonNull(error, "error");
        if (eventId == null || !UUID.matcher(eventId).matches()) {
            throw new IllegalArgumentException("eventId must be a lower-case UUID");
        }
        if (seq < 1) {
            throw new IllegalArgumentException("seq must be >= 1: " + seq);
        }
        if (payloadHash == null || !HASH.matcher(payloadHash).matches()) {
            throw new IllegalArgumentException("payloadHash must be 64 lower-case hex characters");
        }
        if (status == IngestEventStatus.SKIPPED) {
            throw new IllegalArgumentException("SKIPPED rows are not written (Phase 1 Q2)");
        }
        if ((status == IngestEventStatus.FAILED) != error.isPresent()) {
            throw new IllegalArgumentException("error is present exactly when status is FAILED");
        }
    }
}
