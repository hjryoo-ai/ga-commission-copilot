package com.ga.portal.domain;

import java.util.Objects;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 인제스트가 멈춘 사유의 닫힌 어휘(설계서 §6.1 — 상태 표·독 이벤트 분류). {@code ingest_cursor.error}는 {@code "{code}: {detail}"}이고
 * detail에는 seq·eventId·기대값만 쓴다 — payload 값·토큰은 쓰지 않는다.
 */
public enum IngestErrorCode {
    /** 기대값보다 큰 seq — 빠진 이벤트가 있다. */
    SEQ_GAP(IngestState.FAILED),
    /** 피드 응답의 tenantId가 요청한 테넌트가 아니다(잘못된 engine_base_url). */
    TENANT_MISMATCH(IngestState.FAILED),
    /** 422 — afterSeq가 엔진의 headSeq보다 크다(복원된 DB 등 다른 발행자). */
    AFTER_BEYOND_HEAD(IngestState.FAILED),
    /** Envelope 핵심·포털 Envelope·payload 스키마 위반. */
    SCHEMA_VIOLATION(IngestState.FAILED),
    /** type과 aggregate.kind의 짝이 계약과 다르다. */
    TYPE_KIND_MISMATCH(IngestState.FAILED),
    /** 아는 eventId인데 내용 해시가 다르다. */
    HASH_MISMATCH(IngestState.FAILED),
    /** 아는 eventId인데 seq가 다르다. */
    EVENT_SEQ_CONFLICT(IngestState.FAILED),
    /** 기대값보다 작은 seq에 처음 보는 eventId — 발행자 이상. */
    PAST_SEQ_NEW_EVENT(IngestState.FAILED),
    /** 프로젝터가 거부했다(Phase 2부터 불변식 위반). */
    PROJECTOR_ERROR(IngestState.FAILED),
    /** 재구축 재생이 실패해 롤백됐다(설계서 §6.7 — 뷰는 재구축 전 그대로). detail = 원인 사유와 seq. REBUILDING에서만 일어난다. */
    REBUILD_FAILED(IngestState.FAILED),
    /** 적용 트랜잭션의 예기치 않은 오류(DB 제약 위반 등) — 분류하지 못한 것은 멈춘다(정지가 규약, 지시문 D-10). */
    APPLY_ERROR(IngestState.FAILED),
    /** 지원 최대보다 큰 version(설계서 §4.5) — 해석하지 않고 멈춘다. */
    UNSUPPORTED_VERSION(IngestState.PAUSED),
    /** 피드가 401 — 서비스 토큰 설정 문제. */
    FEED_UNAUTHORIZED(IngestState.PAUSED),
    /** 테넌트의 서비스 토큰 파일이 없거나 비었다 — 폴링하지 않는다. */
    TOKEN_MISSING(IngestState.PAUSED),
    /** 운영자 {@code ingest pause}. */
    OPERATOR_PAUSE(IngestState.PAUSED);

    private static final Pattern FORMATTED = Pattern.compile("^([A-Z_]+): (.*)$", Pattern.DOTALL);

    private final IngestState stopsAs;

    IngestErrorCode(IngestState stopsAs) {
        this.stopsAs = stopsAs;
    }

    /** 이 사유로 멈춘 커서의 상태(FAILED 또는 PAUSED). */
    public IngestState stopsAs() {
        return stopsAs;
    }

    /** 이 사유가 일으키는 사건. */
    public IngestTrigger trigger() {
        if (this == OPERATOR_PAUSE) {
            return IngestTrigger.OPERATOR_PAUSE;
        }
        if (this == REBUILD_FAILED) {
            return IngestTrigger.REBUILD_FAILED;
        }
        return stopsAs == IngestState.FAILED ? IngestTrigger.STOP_FAILED : IngestTrigger.STOP_PAUSED;
    }

    /** {@code ingest_cursor.error} 문자열. */
    public String format(String detail) {
        Objects.requireNonNull(detail, "detail");
        return name() + ": " + detail;
    }

    /** {@link #format(String)}로 만든 문자열의 사유. 형식이 아니면 비어 있다. */
    public static Optional<IngestErrorCode> codeOf(String error) {
        if (error == null) {
            return Optional.empty();
        }
        Matcher m = FORMATTED.matcher(error);
        if (!m.matches()) {
            return Optional.empty();
        }
        for (IngestErrorCode c : values()) {
            if (c.name().equals(m.group(1))) {
                return Optional.of(c);
            }
        }
        return Optional.empty();
    }
}
