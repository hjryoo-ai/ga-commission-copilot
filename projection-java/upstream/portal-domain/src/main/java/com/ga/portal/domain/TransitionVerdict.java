package com.ga.portal.domain;

import java.util.Objects;

/** 상태 전이 판정: 다음 상태 또는 거부 사유. */
public sealed interface TransitionVerdict<S> {

    record Next<S>(S state) implements TransitionVerdict<S> {
        public Next {
            Objects.requireNonNull(state, "state");
        }
    }

    record Rejected<S>(ViolationReason reason) implements TransitionVerdict<S> {
        public Rejected {
            Objects.requireNonNull(reason, "reason");
        }
    }
}
