package com.ga.portal.domain.notify;

import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * 알림 {@code link} — 화면 경로 넷({@code /lines/{calcId}}·{@code /limits/{ledgerId}}·{@code /statements/{ym}}·{@code /inquiries/{id}}, 계약
 * {@code ScreenLink}·V7 {@code CHECK}). 키는 엔진의 불투명 문자열이라 RFC 3986 unreserved({@code A-Z a-z 0-9 - . _ ~}) 밖은 UTF-8 바이트마다 {@code %XX}(대문자)로
 * 부호화한다 — 슬래시가 든 키도 경로 한 조각이다(계획 Q20). 화면은 이 넷에 대조한 뒤에만 이동한다(승인 A).
 */
public final class ScreenLinks {

    public static final Pattern PATTERN = Pattern.compile(
            "^/((lines|limits)/[A-Za-z0-9._~%-]+|statements/[0-9]{4}(0[1-9]|1[0-2])|inquiries/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$");
    private static final char[] HEX = "0123456789ABCDEF".toCharArray();

    private ScreenLinks() {
    }

    public static String line(String calcId) {
        return "/lines/" + segment(calcId);
    }

    public static String limit(String ledgerId) {
        return "/limits/" + segment(ledgerId);
    }

    public static String statement(String ym) {
        return "/statements/" + ym;
    }

    public static String inquiry(String inquiryId) {
        return "/inquiries/" + inquiryId;
    }

    /** 경로 한 조각 — unreserved는 그대로, 나머지는 {@code %XX}. */
    static String segment(String key) {
        StringBuilder out = new StringBuilder();
        for (byte b : key.getBytes(StandardCharsets.UTF_8)) {
            char c = (char) (b & 0xff);
            if (c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '.' || c == '_' || c == '~') {
                out.append(c);
            } else {
                out.append('%').append(HEX[(b >> 4) & 0x0f]).append(HEX[b & 0x0f]);
            }
        }
        return out.toString();
    }
}
