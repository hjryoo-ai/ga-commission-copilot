import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";

describe("홈", () => {
  const html = renderToStaticMarkup(<App />);

  it("Hello, 데모GA 제목을 보여준다", () => {
    expect(html).toContain("<h1>Hello, 데모GA</h1>");
  });

  it("푸터에 고정 문구가 있다(설계서 §2.3)", () => {
    expect(html).toContain("<footer>가상 데모 데이터 · 설계사 참고용 · 비확정 · 고객 제시 불가</footer>");
  });
});
