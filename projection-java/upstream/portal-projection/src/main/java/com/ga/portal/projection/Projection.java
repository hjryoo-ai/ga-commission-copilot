package com.ga.portal.projection;

import com.ga.portal.domain.TransitionVerdict;
import com.ga.portal.domain.ViolationReason;

/** 프로젝터 공통: 키 문자열과 판정. */
final class Projection {

    private Projection() {
    }

    static String keys(Envelope e) {
        return "seq " + e.seq() + " eventId " + e.eventId();
    }

    static ProjectionViolation violation(ViolationReason reason, Envelope e, String what) {
        return new ProjectionViolation(reason, keys(e) + " " + what);
    }

    static <S> S accept(TransitionVerdict<S> verdict, Envelope e, String what) {
        return switch (verdict) {
            case TransitionVerdict.Next<S> n -> n.state();
            case TransitionVerdict.Rejected<S> r -> throw violation(r.reason(), e, what);
        };
    }
}
