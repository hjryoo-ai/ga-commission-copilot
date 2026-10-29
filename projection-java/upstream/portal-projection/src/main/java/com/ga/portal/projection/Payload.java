package com.ga.portal.projection;

import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Optional;

/** 스키마 검증을 통과한 payload의 읽기 — 필수 필드는 있다고 믿는다(계약이 보장). 값을 바꾸지 않는다. */
record Payload(JsonNode node) {

    String str(String field) {
        return node.path(field).asString();
    }

    Optional<String> optStr(String field) {
        JsonNode v = node.path(field);
        return v.isMissingNode() || v.isNull() ? Optional.empty() : Optional.of(v.asString());
    }

    long lng(String field) {
        return node.path(field).asLong();
    }

    Optional<Long> optLng(String field) {
        JsonNode v = node.path(field);
        return v.isMissingNode() || v.isNull() ? Optional.empty() : Optional.of(v.asLong());
    }

    LocalDate date(String field) {
        return LocalDate.parse(str(field));
    }

    Instant instant(String field) {
        return OffsetDateTime.parse(str(field)).toInstant();
    }

    /** 하위 객체의 JSON 텍스트(원문 그대로 — 모르는 필드 포함). */
    String json(String field) {
        return node.path(field).toString();
    }
}
