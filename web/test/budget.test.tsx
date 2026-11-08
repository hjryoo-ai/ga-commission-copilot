import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BudgetReport } from "../src/api";
import { App } from "../src/App";
import { match } from "../src/router";
import { BudgetView } from "../src/screens/Budget";

// PHASES Phase 5 항목 6 — 화면 6(/budget, 공개). 값은 API 그대로, 화면은 막대 길이만 계산한다.
const day = (d: string, q: number, g: number, w = 0, o = 0) => ({ day: d, questions: q, calls: g + w + o, providers: { groq: g, "workers-ai": w, openrouter: o } });
const report: BudgetReport = {
  today: { day: "2026-11-06", global: { used: 12, cap: 35 }, calls: { used: 23, cap: 70 }, providers: { groq: { used: 20, cap: 55 }, "workers-ai": { used: 0, cap: 0 }, openrouter: { used: 3, cap: 15 } } },
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

  it("오늘: 질문·호출 열을 나눠(설계서 v0.1.33) — 전체 질문 12/35·전체 호출 23/70·공급자는 호출 열만, Workers AI 0이면 배치 중 안내, 막대 길이 = 사용/상한", () => {
    const html = renderToStaticMarkup(<BudgetView b={report} />);
    const today = html.slice(html.indexOf('data-testid="budget-today"'), html.indexOf("</table>", html.indexOf('data-testid="budget-today"')));
    expect(today).toMatch(/<th scope="col">질문<span[^>]*>답 1건에 1<\/span><\/th><th scope="col">호출<span[^>]*>LLM 1회에 1<\/span><\/th>/);
    expect(today).toContain("12 / 35");
    expect(today).toContain("23 / 70");
    // 공급자 행의 질문 칸은 비어 있다(—) — 질문과 호출을 같은 칸에 섞지 않는다
    expect(today.match(/<td class="muted">—<\/td>/g)).toHaveLength(3);
    expect(html).toContain("20 / 55");
    expect(html).toContain("설명 배치와 뉴런을 나눠 써 배치 중 0");
    expect(html).toContain("--w:36.36363636363637%"); // 20/55
  });

  it("7일 표·폴백 깊이(합 대비)·캐시 적중·거부 사유(영문 코드 없이)·저하", () => {
    const html = renderToStaticMarkup(<BudgetView b={report} />);
    expect(html.match(/<tr>/g)!.length).toBeGreaterThanOrEqual(7 + 4);
    // 7일 표: 질문 | 호출(합·공급자별) — 11-06 행은 질문 6, 호출 합 12
    const days = html.slice(html.indexOf('data-testid="budget-days"'));
    expect(days).toContain('colSpan="4"');
    expect(days).toMatch(/11-06<\/th><td class="num">6<\/td><td class="num">12<\/td>/);
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
