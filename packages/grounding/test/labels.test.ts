// 툴 결과 v2 라벨 표·안정 키 인용·G6 범위(설계서 v0.1.44 §4.2·§4.3.1·§4.3.2). 계약 enum 포함 여부와 web 사본 대조는 gen/test/labels.test.ts(파일을 읽는 쪽).
import { describe, expect, it } from "vitest";
import forbidden from "../forbidden.json" with { type: "json" };
import { contextKeys, fieldInContext, forbiddenViolations, type Json, LABEL_FIELDS, labeledCodes, labelOf, labelTable, NOT_EXPORTED, UNREGISTERED_LABEL } from "../src/index.ts";

describe("라벨 표(v0.1.44 §4.3.2)", () => {
  it("라벨 문자열은 G6 금지어·코드 이름에 걸리지 않는다", () => {
    for (const f of LABEL_FIELDS) for (const [code, label] of Object.entries(labelTable(f))) expect(forbiddenViolations(label), `${f}.${code} "${label}"`).toEqual([]);
    expect(forbiddenViolations(UNREGISTERED_LABEL)).toEqual([]);
  });

  it("CONFIRMED는 '확정'이 아니다 — 마감(지급 전)", () => {
    expect(labelOf("monthStatus", "CONFIRMED")).toEqual({ code: "CONFIRMED", label: "마감(지급 전)", registered: true });
  });

  it("이연 정책·분급 상태는 explain v6 용어 표의 말", () => {
    expect(labelOf("limitCutPolicy", "DEFER_AFTER_FY").label).toBe("한도 초과분 이연");
    expect(labelOf("limitCutPolicy", "DEFER_AFTER_FY").label).not.toContain("삭감");
    expect(labelOf("deferralStatus", "RELEASED").label).toBe("지급됨");
    expect(labelOf("historyKind", "POST").label).toBe("전기");
  });

  it("미등록 코드는 원문 코드 대신 '미등록 사유'(코드·라벨 둘 다)", () => {
    expect(labelOf("commType", "NEW_BONUS")).toEqual({ code: "미등록 사유", label: "미등록 사유", registered: false });
    expect(labelOf("historyReason", "SOMETHING_ELSE").registered).toBe(false);
  });

  it("내보내지 않음 목록과 라벨 표는 겹치지 않는다", () => {
    const labeled = labeledCodes();
    for (const c of NOT_EXPORTED) expect(labeled.has(c), c).toBe(false);
  });

  it("forbidden.json codes는 전부 라벨이 있거나 내보내지 않음에 있다", () => {
    const covered = new Set([...labeledCodes(), ...NOT_EXPORTED]);
    expect(forbidden.codes.filter((c) => !covered.has(c))).toEqual([]);
  });
});

describe("G6 코드 검사는 본문만(v0.1.44 §4.2)", () => {
  it("본문의 코드는 걸리고, 같은 코드가 인용 경로에 있어도 검사 대상이 아니다", () => {
    // forbiddenViolations는 text만 받는다 — citations[].field("byType.FY_COMM")는 답변 파이프라인이 넘기지 않는다
    const answer = { text: "초년도 수수료는 945,000원입니다.", citations: [{ kind: "tool", tool: "get_statement", field: "byType.FY_COMM" }] };
    expect(forbiddenViolations(answer.text)).toEqual([]);
    expect(forbiddenViolations(`${answer.text} FY_COMM`)).toEqual(["CODE:FY_COMM"]);
  });
});

describe("안정 키 인용(v0.1.44 §4.3.1)", () => {
  const data: Json = {
    byType: { FY_COMM: 945000, INCENTIVE: 855000 },
    lines: [
      { calcId: "l-1", commType: "FY_COMM", amount: 945000 },
      { calcId: "l-2", commType: "INCENTIVE", amount: 855000, limitCutAmt: 145000 },
    ],
  };
  const keys = contextKeys(data);

  it("키 경로와 순번 경로 둘 다 받는다", () => {
    expect(fieldInContext("lines[calcId=l-2].limitCutAmt", keys)).toBe(true);
    expect(fieldInContext("lines.1.limitCutAmt", keys)).toBe(true);
    expect(fieldInContext("byType.FY_COMM", keys)).toBe(true);
  });

  it("A-12류: 순번을 잘못 짚으면 실패, 키로 짚으면 통과", () => {
    expect(fieldInContext("lines.0.limitCutAmt", keys)).toBe(false);
    expect(fieldInContext("lines[calcId=l-2].limitCutAmt", keys)).toBe(true);
  });

  it("없는 키 값·다른 키 이름은 실패", () => {
    expect(fieldInContext("lines[calcId=l-9].amount", keys)).toBe(false);
    expect(fieldInContext("lines[scheduleId=l-2].amount", keys)).toBe(false);
  });
});
