package com.ga.portal.domain.rule;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/**
 * 레이트 리밋 판정(포털 Phase 5 ③, 계획 Q5) — 순수 함수. 그 설계사의 창 안 행 수가 한도 이상이면 거부하고, {@code Retry-After} = 창 안 가장 오래된 행이
 * 창을 벗어날 때까지의 초(올림, 최소 1). 나눗셈 없이 {@link Duration}의 초·나노로 올린다(곱셈·나눗셈 허용 목록 밖 — {@code MultiplicationScanTest}).
 * 창은 호출자가 정한다(Phase 6 계획 Q12 — {@code portal-sim}에서 옮겼다): 시뮬레이션 60초, 문의 24시간.
 */
public final class RateLimitRule {

    private RateLimitRule() {
    }

    /** 비어 있으면 통과. 아니면 {@code Retry-After} 초. */
    public static Optional<Long> retryAfter(long countInWindow, Optional<Instant> oldest, int limit, Duration window, Instant now) {
        if (limit < 1) {
            throw new IllegalArgumentException("limit must be positive");
        }
        if (window.isNegative() || window.isZero()) {
            throw new IllegalArgumentException("window must be positive");
        }
        if (countInWindow < limit) {
            return Optional.empty();
        }
        Duration wait = Duration.between(now, oldest.orElse(now).plus(window));
        long seconds = wait.getSeconds() + (wait.getNano() > 0 ? 1 : 0);
        return Optional.of(Math.max(1L, seconds));
    }
}
