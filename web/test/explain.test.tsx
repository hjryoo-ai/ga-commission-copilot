import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { citedClass, ExplanationBody, isCited } from "../src/explain";

// PHASES Phase 3 항목 5: 설명 블록 — 검증 배지·고정 문구·근거 보기(인용 필드 하이라이트). 숫자를 다시 계산하지 않는다.
const pass = {
  groundingStatus: "PASS" as const,
  text: "이 라인의 지급액은 855,000원입니다.",
  citedFields: ["line.amount", "deferrals[0].dueYm", "receivable"],
  numbersUsed: ["855,000원"],
  promptVersion: "explain_line/v2",
  model: "openai/gpt-oss-120b",
};

describe("설명 블록", () => {
  it("PASS: 검증 통과 배지·본문·고정 문구·근거 보기 버튼", () => {
    const html = renderToStaticMarkup(<ExplanationBody e={pass} />);
    expect(html).toContain("검증 통과");
    expect(html).toContain("855,000원입니다");
    expect(html).toContain("가상 데모 데이터 · 설계사 참고용 · 비확정 · 고객 제시 불가");
    expect(html).toContain("근거 보기");
    expect(html).toContain("explain_line/v2");
  });

  it("FAIL·없음: 본문 없이 '설명 없음'", () => {
    const fail = renderToStaticMarkup(<ExplanationBody e={{ groundingStatus: "FAIL", promptVersion: "explain_line/v2" }} />);
    expect(fail).toContain("설명 없음");
    expect(fail).not.toContain("근거 보기");
    expect(renderToStaticMarkup(<ExplanationBody e={null} />)).toContain("설명 없음");
  });

  it("인용 경로 대조: 같은 필드·하위 필드·상위 객체, 배열 표기", () => {
    expect(isCited(pass.citedFields, "line.amount")).toBe(true);
    expect(isCited(pass.citedFields, "deferrals.0")).toBe(true);
    expect(isCited(pass.citedFields, "receivable")).toBe(true);
    expect(isCited(["receivable.amount"], "receivable")).toBe(true);
    expect(isCited(pass.citedFields, "deferrals.1", "basis.rate")).toBe(false);
    expect(isCited(["line.amountX"], "line.amount")).toBe(false);
  });

  it("근거 보기가 꺼져 있으면 하이라이트 없음", () => {
    expect(citedClass(null, "line.amount")).toBeUndefined();
    expect(citedClass(pass.citedFields, "line.amount")).toBe("cited");
  });
});
