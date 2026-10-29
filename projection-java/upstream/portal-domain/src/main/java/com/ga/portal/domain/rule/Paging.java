package com.ga.portal.domain.rule;

/**
 * 페이지 오프셋 {@code page × size}(포털 Phase 6 — 라인·알림·문의 목록이 같이 쓴다). 금액이 아니다. 포털 바이트코드의 곱셈은 허용 목록의 메서드에만 있을 수 있어
 * ({@code MultiplicationScanTest}) 목록마다 곱하지 않고 여기 한 곳에서 곱한다(넘치면 예외).
 */
public final class Paging {

    private Paging() {
    }

    public static long offset(int page, int size) {
        if (page < 0 || size < 1) {
            throw new IllegalArgumentException("page/size");
        }
        return Math.multiplyExact((long) page, (long) size);
    }
}
