package com.ga.portal.domain.access;

import java.util.Objects;

/**
 * 인증은 됐으나 보여 줄 것이 없다 — 응답은 사유와 무관하게 같은 404 바이트, 사유는 감사·지표에만(지시문 D-3). 메시지는 사유 코드뿐(키·식별자 값 없음 — 로그로
 * 새지 않게). 스택은 남기지 않는다(흐름 제어용 예외).
 */
public final class NotFound extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final DenyReason reason;

    public NotFound(DenyReason reason) {
        super(Objects.requireNonNull(reason, "reason").name(), null, false, false);
        this.reason = reason;
    }

    public DenyReason reason() {
        return reason;
    }
}
