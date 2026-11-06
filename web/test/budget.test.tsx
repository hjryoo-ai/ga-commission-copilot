import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BudgetReport } from "../src/api";
import { App } from "../src/App";
import { match } from "../src/router";
import { BudgetView } from "../src/screens/Budget";

// PHASES Phase 5 항목 6 — 화면 6(/budget, 공개). 값은 API 그대로, 화면은 막대 길이만 계산한다.
const day = (d: string, q: number, g: number, w = 0, o = 0) => ({ day: d, questions: q, providers: { groq: g, "workers-ai": w, openrouter: o } });
const report: BudgetReport = {
  today: { day: "2026-11-06", global: { used: 12, cap: 70 }, providers: { groq: { used: 20, cap: 55 }, "workers-ai": { used: 0, cap: 0 }, openrouter: { used: 3, cap: 15 } } },
  days: ["10-31", "11-01", "11-02", "11-03", "11-04", "11-05", "11-06"].map((d, i) => day(`2026-${d}`, i, i * 2)),
  fallbackDepth: { "0": 9, "1": 0, "2": 3 },
  refusals: { BUDGET: 2, OTHER_AGENT: 1 },
  cache: { hit: 0, miss: 12 },
  degraded: { rules: 1 },
  disclaimer: "",
};

describe("화면 6 예산·관측", () => {
  it("경로 /budget(공개 — 세션 없이), 설계사 선택에서 링크", () => {
    expect(match("/budget")).toEqual({ name: "budget" });
    expect(renderToStaticMarkup(<App path="/" />)).toContain('href="/budget"');
    expect(renderToStaticMarkup(<App path="/budget" />)).toContain("<h1>예산·관측</h1>");
  });

  it("오늘: 전체·공급자별 사용/상한, Workers AI 0이면 배치 중 안내, 막대 길이 = 사용/상한", () => {
    const html = renderToStaticMarkup(<BudgetView b={report} />);
    expect(html).toContain("12 / 70");
    expect(html).toContain("20 / 55");
    expect(html).toContain("설명 배치와 뉴런을 나눠 써 배치 중 0");
    expect(html).toContain("--w:36.36363636363637%"); // 20/55
  });

  it("7일 표·폴백 깊이(합 대비)·캐시 적중·거부 사유(영문 코드 없이)·저하", () => {
    const html = renderToStaticMarkup(<BudgetView b={report} />);
    expect(html.match(/<tr>/g)!.length).toBeGreaterThanOrEqual(7 + 4);
    expect(html).toContain("1순위(Groq)");
    expect(html).toContain("9 / 12");
    expect(html).toContain("0% (0/12)");
    expect(html).toContain("예산 소진");
    expect(html).toContain("다른 설계사");
    expect(html).not.toMatch(/>BUDGET<|>OTHER_AGENT</);
    expect(html).toContain("1건");
    expect(renderToStaticMarkup(<BudgetView b={{ ...report, fallbackDepth: { "0": 0, "1": 0, "2": 0 }, cache: { hit: 0, miss: 0 } }} />)).toContain("기록 없음");
  });
});
