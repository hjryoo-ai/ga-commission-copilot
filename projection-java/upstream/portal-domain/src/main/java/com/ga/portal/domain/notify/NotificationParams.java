package com.ga.portal.domain.notify;

import java.time.LocalDate;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * 알림 {@code params}의 닫힌 모양 여섯(계약 1.2.0 {@code Notification} 변이와 같다 — {@code InboxApiContractTest}). 무슨 일이 어느 계약·라인·달·문의에
 * 생겼는지만 담는다 — <b>금액이 없다</b>(계획 Q1). 증권번호는 가린 값({@code policyMasked})만이다.
 */
public sealed interface NotificationParams {

    Pattern YM = Pattern.compile("^[0-9]{4}(0[1-9]|1[0-2])$");
    Pattern MASKED = Pattern.compile("^[*]+[^*]{0,4}$");
    Pattern UUID = Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");

    /** 한도 원장 — {@code LIMIT_WARN}·{@code LIMIT_CRIT}·{@code LIMIT_FULL}·{@code LIMIT_REBASE}. */
    record Ledger(String ledgerId, String policyMasked) implements NotificationParams {
        public Ledger {
            requireKey(ledgerId, "ledgerId");
            requireMasked(policyMasked);
        }
    }

    /** 라인 — {@code LIMIT_CUT}·{@code CLAWBACK}. */
    record Line(String calcId, String policyMasked, String closeYm) implements NotificationParams {
        public Line {
            requireKey(calcId, "calcId");
            requireMasked(policyMasked);
            requireYm(closeYm, "closeYm");
        }
    }

    /** 분급 항목 — {@code DEFER_HELD}·{@code DEFER_CANCELLED}. {@code calcId}는 그 분급을 만든 원 라인. */
    record Deferral(String calcId, String policyMasked, String dueYm) implements NotificationParams {
        public Deferral {
            requireKey(calcId, "calcId");
            requireMasked(policyMasked);
            requireYm(dueYm, "dueYm");
        }
    }

    /** 계약 상태 — {@code POLICY_PAYMENT_OVERDUE}·{@code POLICY_LAPSE}·{@code POLICY_CANCEL}. */
    record Policy(String policyMasked, LocalDate occurredOn) implements NotificationParams {
        public Policy {
            requireMasked(policyMasked);
            Objects.requireNonNull(occurredOn, "occurredOn");
        }
    }

    /** 월 명세 — {@code STMT_CONFIRMED}·{@code PAYOUT}. */
    record Month(String ym) implements NotificationParams {
        public Month {
            requireYm(ym, "ym");
        }
    }

    /** 문의 답변 — {@code INQUIRY_ANSWERED}. */
    record Inquiry(String inquiryId) implements NotificationParams {
        public Inquiry {
            Objects.requireNonNull(inquiryId, "inquiryId");
            if (!UUID.matcher(inquiryId).matches()) {
                throw new IllegalArgumentException("inquiryId");
            }
        }
    }

    private static void requireKey(String value, String name) {
        Objects.requireNonNull(value, name);
        if (value.isEmpty() || value.codePointCount(0, value.length()) > 128) {
            throw new IllegalArgumentException(name);
        }
    }

    private static void requireMasked(String value) {
        Objects.requireNonNull(value, "policyMasked");
        if (!MASKED.matcher(value).matches()) {
            throw new IllegalArgumentException("policyMasked");
        }
    }

    private static void requireYm(String value, String name) {
        Objects.requireNonNull(value, name);
        if (!YM.matcher(value).matches()) {
            throw new IllegalArgumentException(name);
        }
    }
}
