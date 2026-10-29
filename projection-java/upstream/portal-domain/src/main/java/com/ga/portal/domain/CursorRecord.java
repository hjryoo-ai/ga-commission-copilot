package com.ga.portal.domain;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;

/**
 * {@code ingest_cursor} 행(설계서 §5·§6.1) — 테넌트별 마지막 적용 seq·eventId와 상태. {@code error}는
 * {@link IngestErrorCode#format(String)} 형식이고 RUNNING이면 없다.
 */
public record CursorRecord(long lastSeq, Optional<String> lastEventId, IngestState state, Instant updatedAt, Optional<String> error) {

    public CursorRecord {
        Objects.requireNonNull(lastEventId, "lastEventId");
        Objects.requireNonNull(state, "state");
        Objects.requireNonNull(updatedAt, "updatedAt");
        Objects.requireNonNull(error, "error");
        if (lastSeq < 0) {
            throw new IllegalArgumentException("lastSeq must be >= 0: " + lastSeq);
        }
    }

    /** 멈춘 사유(형식이 맞을 때). */
    public Optional<IngestErrorCode> errorCode() {
        return error.flatMap(IngestErrorCode::codeOf);
    }
}
