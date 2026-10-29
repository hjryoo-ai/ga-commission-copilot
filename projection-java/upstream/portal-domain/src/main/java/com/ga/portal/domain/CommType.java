package com.ga.portal.domain;

import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 수수료 라인 유형(설계서 §5 {@code earnings_line.comm_type}). 엔진이 정하는 **열린 값**이다 — 모르는 유형도 받아 저장·표시하고
 * (계약 호환 규칙 §4.5), 포털이 아는 유형은 상수로 둔다. 월 합산의 분류(§5 {@code earnings_month})에 필요한 판정만 제공한다.
 */
public record CommType(String value) {

    private static final Pattern FORMAT = Pattern.compile("[A-Z][A-Z0-9_]{0,31}");

    public static final CommType FY_COMM = new CommType("FY_COMM");
    public static final CommType RENEWAL = new CommType("RENEWAL");
    public static final CommType INCENTIVE = new CommType("INCENTIVE");
    public static final CommType OVERRIDE = new CommType("OVERRIDE");
    public static final CommType DEFERRED = new CommType("DEFERRED");
    public static final CommType CLAWBACK = new CommType("CLAWBACK");
    public static final CommType ADJUSTMENT = new CommType("ADJUSTMENT");

    /** 설계서 §5 주석에 이름이 나온 유형. 이 밖의 값도 유효하다. */
    public static final Set<CommType> KNOWN = Set.of(FY_COMM, RENEWAL, INCENTIVE, OVERRIDE, DEFERRED, CLAWBACK, ADJUSTMENT);

    public CommType {
        Objects.requireNonNull(value, "CommType must not be null");
        if (!FORMAT.matcher(value).matches()) {
            throw new IllegalArgumentException("CommType must match " + FORMAT.pattern());
        }
    }

    public static CommType of(String value) {
        return new CommType(value);
    }

    /** 환수 라인 — 월 합산에서 {@code clawback_offset}로 간다(엔진에서 환수는 음수 COMM_CALC, 설계서 §4.2). */
    public boolean isClawback() {
        return equals(CLAWBACK);
    }

    /** 마감 후 정정 라인 — 월 합산에서 {@code adjustment}로 간다(AdjustmentPosted). */
    public boolean isAdjustment() {
        return equals(ADJUSTMENT);
    }

    public boolean isKnown() {
        return KNOWN.contains(this);
    }

    @Override
    public String toString() {
        return value;
    }
}
