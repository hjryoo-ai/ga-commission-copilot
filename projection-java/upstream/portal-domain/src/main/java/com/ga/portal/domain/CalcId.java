package com.ga.portal.domain;

/** 엔진 수수료 계산(COMM_CALC) 식별자 — earnings_line의 키, CommissionCalculated·AdjustmentPosted의 calcId·targetCalcId. */
public record CalcId(String value) {

    public CalcId {
        Identifiers.require("CalcId", value);
    }

    public static CalcId of(String value) {
        return new CalcId(value);
    }

    @Override
    public String toString() {
        return value;
    }
}
