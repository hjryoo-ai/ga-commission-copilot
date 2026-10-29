package com.ga.portal.projection;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

import java.time.OffsetDateTime;
import java.util.Objects;

/**
 * 엔진 이벤트 Envelope(설계서 §4.1, 계약 {@code contracts/events/v1/envelope.schema.json}). 스키마 검증을 통과한 뒤에만 만든다 —
 * 형식 검사는 이 타입이 아니라 계약 스키마의 일이다.
 *
 * @param occurredAt 원문 그대로(오프셋 포함 ISO-8601) — 정규 해시가 원문을 쓰므로 다시 쓰지 않는다
 * @param payload    type별 payload. 모르는 필드도 그대로 있다(설계서 §4.5 — 소비자는 무시)
 * @param source     받은 Envelope 전체(모르는 최상위 필드 보존). 읽기 전용으로 다룬다
 */
public record Envelope(String eventId, long seq, String type, int version, String occurredAt, Aggregate aggregate,
                       JsonNode payload, ObjectNode source) {

    public Envelope {
        Objects.requireNonNull(eventId, "eventId");
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(occurredAt, "occurredAt");
        Objects.requireNonNull(aggregate, "aggregate");
        Objects.requireNonNull(payload, "payload");
        Objects.requireNonNull(source, "source");
    }

    /** 사실의 시각. */
    public OffsetDateTime occurredAtTime() {
        return OffsetDateTime.parse(occurredAt);
    }

    /** {@code aggregate{kind, id}} — kind는 type과 짝(계약이 강제). */
    public record Aggregate(String kind, String id) {
        public Aggregate {
            Objects.requireNonNull(kind, "kind");
            Objects.requireNonNull(id, "id");
        }
    }
}
