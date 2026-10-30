import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";
import { match } from "../src/router";

describe("화면 틀", () => {
  it("/ 는 설계사 선택: 제목·하지 않는 것 3줄·고정 문구 푸터(설계서 §2.3·§8-1)", () => {
    const html = renderToStaticMarkup(<App path="/" />);
    expect(html).toContain("<h1>GA 수수료 설명 코파일럿</h1>");
    expect(html).toContain("이 데모가 하지 않는 것");
    expect(html).toContain("<footer>가상 데모 데이터 · 설계사 참고용 · 비확정 · 고객 제시 불가</footer>");
  });

  it("상단 칩 3개 중 기준 데이터만 실제, 나머지는 자리만", () => {
    const html = renderToStaticMarkup(<App path="/me/limits" />);
    expect(html).toContain('data-testid="chip-data"');
    expect(html.match(/chip placeholder/g)).toHaveLength(2);
  });

  it("경로는 닫힌 목록", () => {
    expect(match("/")).toEqual({ name: "select" });
    expect(match("/me/earnings/202608")).toEqual({ name: "statement", ym: "202608" });
    expect(match("/me/earnings/lines/c-POL-2026-0001-1")).toEqual({ name: "line", calcId: "c-POL-2026-0001-1" });
    expect(match("/me/limits/l%2F1")).toEqual({ name: "limit", ledgerId: "l/1" });
    expect(match("/me/earnings/2026-08")).toEqual({ name: "notFound" });
    expect(match("/admin")).toEqual({ name: "notFound" });
  });
});
