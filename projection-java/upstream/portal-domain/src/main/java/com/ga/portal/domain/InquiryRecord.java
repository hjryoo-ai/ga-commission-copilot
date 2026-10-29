package com.ga.portal.domain;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * {@code inquiry} 행(테넌트 열 제외, V7). {@code message}·{@code answer}는 설계사·운영자의 자유 텍스트다 — 작성자 상세 응답과 운영 CLI {@code list} 출력에만
 * 나온다(포털 Phase 6 계획 Q23·C7). 그래서 {@link #toString()}은 두 본문을 싣지 않는다(로그·예외 메시지로 새지 않게).
 */
public record InquiryRecord(UUID id, String agentId, Optional<String> calcId, InquiryCategory category, String message, InquiryStatus status,
                            Instant createdAt, Optional<Instant> answeredAt, Optional<String> answer, Optional<String> answeredBy) {

    public InquiryRecord {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(agentId, "agentId");
        Objects.requireNonNull(calcId, "calcId");
        Objects.requireNonNull(category, "category");
        Objects.requireNonNull(message, "message");
        Objects.requireNonNull(status, "status");
        Objects.requireNonNull(createdAt, "createdAt");
        Objects.requireNonNull(answeredAt, "answeredAt");
        Objects.requireNonNull(answer, "answer");
        Objects.requireNonNull(answeredBy, "answeredBy");
        if (category.requiresCalcId() && calcId.isEmpty()) {
            throw new IllegalArgumentException("calcId required for " + category);
        }
    }

    /** 새 접수 — {@code OPEN}, 답변 없음. */
    public static InquiryRecord open(UUID id, String agentId, Optional<String> calcId, InquiryCategory category, String message, Instant createdAt) {
        return new InquiryRecord(id, agentId, calcId, category, message, InquiryStatus.OPEN, createdAt, Optional.empty(), Optional.empty(),
                Optional.empty());
    }

    @Override
    public String toString() {
        return "InquiryRecord[id=" + id + ", category=" + category + ", status=" + status + ", createdAt=" + createdAt + "]";
    }
}
