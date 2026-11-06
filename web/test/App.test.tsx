import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";
import { match } from "../src/router";
import { Chips } from "../src/ui";

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

  it("칩(설계서 v0.1.27): /me budget이 오면 오늘 남은 질문 = min(전역, 사용자), 0이면 경고, 프롬프트 answer 버전", () => {
    const asOf = { streamHash: "f".repeat(64), generatedAt: "2026-10-30T12:19:15Z", demoNo: 1 as const };
    const me = { asOf, dataStatus: "OK" as const, disclaimer: "", agentId: "A-1001", promptVersions: { answer: "v3" }, budget: { remainingToday: 52, userRemaining: 7, resetsAt: "2026-11-07T00:00:00.000Z" } };
    const html = renderToStaticMarkup(<Chips asOf={asOf} me={me} />);
    expect(html).toContain("오늘 남은 질문 7회");
    expect(html).toContain("프롬프트 answer=v3");
    expect(html).not.toContain("placeholder");
    const out = renderToStaticMarkup(<Chips asOf={asOf} me={{ ...me, budget: { ...me.budget, remainingToday: 0 } }} />);
    expect(out).toContain('class="chip warn"');
    expect(out).toContain("오늘 남은 질문 0회");
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
