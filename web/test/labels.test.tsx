import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Line, Month, MonthStatus, NetBasis } from "../src/api";
import { monthWindow, won } from "../src/format";
import { grossLabel, MONTH_STATUS_LABEL, netCell } from "../src/labels";
import { foldLines, MonthCard } from "../src/screens/Statement";
import { UsageBar } from "../src/screens/Limits";

// PHASES Phase 2 항목 6: 상태 라벨(PROVISIONAL/ESTIMATED/CONFIRMED/PAID) 렌더 — 상위 v1.9 §6.2 표.
const asOf = { streamHash: "e".repeat(64), generatedAt: "2026-10-30T10:59:50.264Z", demoNo: 1 as const };
const month = (status: MonthStatus, netBasis?: NetBasis, extra: Partial<Month> = {}): Month => ({
  asOf,
  dataStatus: "OK",
  disclaimer: "x",
  closeYm: "202608",
  status,
  monthDataStatus: "OK",
  gross: 1_800_000,
  clawbackOffset: -100_000,
  adjustment: 0,
  byType: { FY_COMM: 1_800_000 },
  ...(netBasis ? { netBasis, net: 1_740_600, withholdingTax: 59_400 } : {}),
  ...extra,
});

describe("월 상태 라벨", () => {
  it("PROVISIONAL·ESTIMATED → 예상, CONFIRMED → 확정, PAID → 지급완료", () => {
    expect(MONTH_STATUS_LABEL).toEqual({ PROVISIONAL: "예상", ESTIMATED: "예상", CONFIRMED: "확정", PAID: "지급완료" });
    expect(grossLabel("CONFIRMED", "ESTIMATE")).toBe("확정(세후 예상)");
  });

  it.each([
    ["PROVISIONAL", undefined, "예상", "세후는 야간 산출 후 표시"],
    ["ESTIMATED", "ESTIMATE", "예상", "기준 2026-10-01"],
    ["CONFIRMED", "ESTIMATE", "확정(세후 예상)", "실수령"],
    ["CONFIRMED", undefined, "확정", "세후는 지급 시 확정"],
    ["CONFIRMED", "CONFIRM", "확정", "실수령"],
    ["PAID", "PAYOUT", "지급완료", "지급일 2026-09-10"],
  ] as const)("%s/%s 월 카드: 세전 라벨 %s, %s", (status, basis, gross, text) => {
    const html = renderToStaticMarkup(<MonthCard m={month(status, basis, { estimateAsOf: "2026-10-01T00:30:00Z", paidAt: "2026-09-10T00:30:00Z", paidAmount: 1_740_600 })} />);
    expect(html).toContain(`<span class="tag">${gross}</span>`);
    expect(html).toContain(text);
    expect(html).toContain(won(1_800_000));
    // 지급 런 값은 PAID 달에만
    expect(html.includes("지급액")).toBe(status === "PAID");
  });

  it("세후 16칸: 표의 6칸만 보이고 나머지 10칸은 숨김 '세후 정보 없음'", () => {
    const statuses: MonthStatus[] = ["PROVISIONAL", "ESTIMATED", "CONFIRMED", "PAID"];
    const bases: (NetBasis | undefined)[] = [undefined, "ESTIMATE", "CONFIRM", "PAYOUT"];
    const cells = statuses.flatMap((s) => bases.map((b) => [s, b ?? "-", netCell(s, b)] as const));
    expect(cells).toHaveLength(16);
    expect(cells.filter(([, , c]) => c.show).map(([s, b, c]) => `${s}/${b}=${c.show ? c.label : ""}`)).toEqual([
      "ESTIMATED/ESTIMATE=예상",
      "CONFIRMED/ESTIMATE=예상",
      "CONFIRMED/CONFIRM=확정",
      "PAID/PAYOUT=지급완료",
    ]);
    const hidden = cells.filter(([, , c]) => !c.show && c.note === "세후 정보 없음");
    expect(hidden).toHaveLength(10);
  });

  it("정정 금액은 어느 달이든 '지급 반영 미정', 대사 불일치 달은 배지", () => {
    const html = renderToStaticMarkup(<MonthCard m={month("PAID", "PAYOUT", { adjustment: 25_000, monthDataStatus: "DRIFT" })} />);
    expect(html).toContain(`${won(25_000)}</span> <span class="tag">지급 반영 미정</span>`);
    expect(html).toContain("대사 불일치");
  });
});

describe("명세 라인 접기(같은 달 짝만)", () => {
  const L = (calcId: string, extra: Partial<Line> = {}): Line => ({ calcId, closeYm: "202608", commType: "FY_COMM", amount: 1, limitCutAmt: 0, policyMasked: "*1", policyKey: "0".repeat(16), ...extra });

  it("같은 달 원 라인은 취소 라인 아래로 접고, 다른 달 짝은 접지 않는다", () => {
    const rows = foldLines(
      [L("a"), L("b", { reversedBy: "br", reversedByYm: "202608" }), L("br", { reversalOf: "b", reversalOfYm: "202608" }), L("c", { reversedBy: "cr", reversedByYm: "202609" }), L("d", { reversalOf: "x", reversalOfYm: "202607" })],
      "202608",
    );
    expect(rows.map((r) => [r.line.calcId, r.folded?.calcId ?? null])).toEqual([
      ["a", null],
      ["br", "b"],
      ["c", null],
      ["d", null],
    ]);
  });
});

describe("표시 형식", () => {
  it("월 목록 범위는 마지막 달에서 최대 36개월", () => {
    expect(monthWindow("202507", "202806")).toEqual({ from: "202507", to: "202806" });
    expect(monthWindow("202401", "202806")).toEqual({ from: "202507", to: "202806" });
    expect(monthWindow("202603", "202806")).toEqual({ from: "202603", to: "202806" });
  });

  it("소진 바는 문자열을 그대로 CSS 변수로", () => {
    expect(renderToStaticMarkup(<UsageBar utilization="52.5%" />)).toContain("--w:52.5%");
    expect(renderToStaticMarkup(<UsageBar />)).toContain("소진율 없음");
  });
});
