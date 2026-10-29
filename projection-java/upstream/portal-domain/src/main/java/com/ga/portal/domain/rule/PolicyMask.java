package com.ga.portal.domain.rule;

/**
 * {@code policyMasked}(지시문 D-7): 증권번호의 끝 4자만 남기고 나머지는 {@code *}(4자 이하면 전부 {@code *}). 응답에 증권번호 원문은 없다 — 필터·연결은
 * {@code policyKey}(배포 비밀의 HMAC)로 한다.
 */
public final class PolicyMask {

    // TODO(confirm#5): 기본 가정 — 모든 테넌트 끝 4자, 포털 응답 시점 마스킹(설계서 §14.1 #5)
    static final int VISIBLE = 4;

    private PolicyMask() {
    }

    public static String mask(String policyNo) {
        int n = policyNo.length();
        if (n <= VISIBLE) {
            return "*".repeat(n);
        }
        return "*".repeat(n - VISIBLE) + policyNo.substring(n - VISIBLE);
    }
}
