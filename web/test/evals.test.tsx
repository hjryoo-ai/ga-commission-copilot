import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EvalCase, EvalRunDetail, EvalRunSummary, EvalsReport } from "../src/api";
import { App } from "../src/App";
import { match, paths } from "../src/router";
import { EvalRunView, EvalsView, pct } from "../src/screens/Evals";

// PHASES Phase 6 항목 5 — 화면 5(/evals, 공개). 값은 API 그대로 — 화면은 백분율 표기만.
const run = (runId: string, startedAt: string, trigger: string, rates: EvalRunSummary["rates"], passed: number): EvalRunSummary => ({
  runId,
  startedAt,
  trigger,
  promptVersions: { answer: "v3", schema_hint: "v1" },
  streamHash: "h",
  model: "groq+workers-ai",
  total: 60,
  passed,
  rates,
  meanLatencyMs: 27545,
  rulesUnavailable: { total: 4, passed: 2 },
});
const base = run("20261113T225638-baseline", "2026-11-13T22:56:38.000Z", "baseline", { grounding: 0.5, refusal: 0.8333, tool: 0.6486, content: 0.1111 }, 18);
const r1 = run("20261113T225638-baseline-r1", "2026-11-13T22:56:38.000Z", "rescore:baseline", { grounding: 0.5526, refusal: 0.8333, tool: 0.6667, content: 0.2889 }, 26);

const c = (o: Partial<EvalCase>): EvalCase => ({
  caseId: "A-01",
  mode: "normal",
  bucket: "line",
  question: "8월 시책이 100만 원인데 왜 85만 5천 원만 들어왔나요?",
  passed: false,
  failureKind: "CONTENT",
  provider: "groq",
  refused: false,
  reason: null,
  groundingStatus: "PASS",
  text: "855,000원입니다.",
  toolCalls: [{ tool: "get_statement", args: { ym: "202608" } }],
  error: null,
  latencyMs: 30000,
  expectedTools: [{ tool: "get_statement", args: { ym: "202608" } }],
  facts: ["지급 855,000", "한도 초과 145,000", "이연"],
  expectRefusal: false,
  expectReason: null,
  missingFacts: ["이연"],
  forbiddenHits: ["삭감된"],
  violations: { g1Shape: [], g4Missing: [], g5Unknown: [], g6Words: [] },
  ...o,
});

describe("화면 5 평가 리포트", () => {
  it("경로 /evals·/evals/{runId}(공개), 설계사 선택에서 링크", () => {
    expect(match("/evals")).toEqual({ name: "evals" });
    expect(match("/evals/20261113T225638-baseline-r1")).toEqual({ name: "evalRun", runId: "20261113T225638-baseline-r1" });
    expect(match("/evals/../x")).toEqual({ name: "notFound" });
    expect(paths.evalRun("20261113T225638-baseline")).toBe("/evals/20261113T225638-baseline");
    expect(renderToStaticMarkup(<App path="/" />)).toContain('href="/evals"');
    expect(renderToStaticMarkup(<App path="/evals" />)).toContain("<h1>평가 리포트</h1>");
  });

  it("백분율 표기: 0~1 → 소수 둘째 자리 %, null은 —", () => {
    expect(pct(0.8333)).toBe("83.33%");
    expect(pct(1)).toBe("100%");
    expect(pct(null)).toBe("—");
  });

  it("추이 차트: 범례 4축 + 끝 직접 라벨(최근 런 값), 런 표에 같은 숫자(색만으로 읽지 않게)", () => {
    const report: EvalsReport = { runs: [r1, base], variance: null, disclaimer: "" };
    const html = renderToStaticMarkup(<EvalsView r={report} />);
    for (const label of ["그라운딩", "거부", "툴", "내용"]) expect(html).toContain(`</span>${label}</li>`);
    expect(html).toContain("그라운딩 55.26%");
    expect(html).toContain("내용 28.89%");
    expect(html).toMatch(/stroke-width="2"/);
    const table = html.slice(html.indexOf('data-testid="evals-runs"'));
    expect(table.indexOf("20261113T225638-baseline-r1")).toBeLessThan(table.indexOf('href="/evals/20261113T225638-baseline"'));
    expect(table).toContain("26/60");
    expect(table).toContain("2/4");
    expect(html).toContain("아직 variance 런이 없습니다");
  });

  it("추이는 60문항 런(기준선·주간·재채점)만 — PR 표본·variance·stub 런은 표에만", () => {
    const pr = { ...run("20261116T001000-pr-7", "2026-11-16T00:10:00.000Z", "pr:7", { grounding: 1, refusal: 1, tool: 1, content: 1 }, 20), total: 20 };
    const html = renderToStaticMarkup(<EvalsView r={{ runs: [pr, r1, base], variance: null }} />);
    const chart = html.slice(html.indexOf('data-testid="evals-trend"'), html.indexOf('data-testid="evals-runs"'));
    expect(chart).toContain("재채점");
    expect(chart).not.toContain("11-16");
    expect(html).toContain("4축 추이(60문항 런 2개)");
    expect(html.slice(html.indexOf('data-testid="evals-runs"'))).toContain("20261116T001000-pr-7");
  });

  it("n=3 분산: 케이스별 통과/실패·통과 횟수, n회 중 n-1회 이하는 v4 대상", () => {
    const report: EvalsReport = {
      runs: [base],
      variance: {
        promptVersions: { answer: "v3", schema_hint: "v1" },
        runs: ["2026-11-15", "2026-11-16", "2026-11-17"].map((d) => ({ runId: `x-${d}`, startedAt: `${d}T00:10:00Z`, trigger: `variance:${d}` })),
        cases: [
          { caseId: "A-01", question: "q1", results: [true, true, true], passes: 3, n: 3 },
          { caseId: "A-12", question: "q12", results: [true, false, true], passes: 2, n: 3 },
        ],
        distribution: { "3": 1, "2": 1, "1": 0, "0": 0 },
      },
      disclaimer: "",
    };
    const html = renderToStaticMarkup(<EvalsView r={report} />);
    const v = html.slice(html.indexOf('data-testid="evals-variance"'));
    expect(v).toContain("<th scope=\"col\">2026-11-16</th>");
    expect(v).toMatch(/A-12[\s\S]*실패[\s\S]*2\/3[\s\S]*v4 대상/);
    expect(v.slice(0, v.indexOf("A-12"))).not.toContain("v4 대상");
    expect(html).toContain("3/3 1건 · 2/3 1건");
  });

  it("런 상세: 실패 먼저 표(질문·기대·실제·빠진 사실·금지어), 유형별 통과 5줄, 모델별 4축, 규정 검색 끔은 따로", () => {
    const d: EvalRunDetail = {
      run: r1,
      byProvider: {
        groq: { total: 29, passed: 7, grounding: { n: 23, pass: 11, rate: 0.4783 }, refusal: { n: 29, pass: 26, rate: 0.8966 }, tool: { n: 24, pass: 18, rate: 0.75 }, content: { n: 26, pass: 4, rate: 0.1538 } },
        "workers-ai": { total: 31, passed: 19, grounding: { n: 15, pass: 10, rate: 0.6667 }, refusal: { n: 31, pass: 24, rate: 0.7742 }, tool: { n: 12, pass: 6, rate: 0.5 }, content: { n: 19, pass: 9, rate: 0.4737 } },
      },
      byBucket: [
        { bucket: "line", total: 15, passed: 2 },
        { bucket: "limit", total: 12, passed: 1 },
        { bucket: "deferral", total: 8, passed: 1 },
        { bucket: "rule", total: 10, passed: 9 },
        { bucket: "refusal", total: 15, passed: 13 },
      ],
      cases: [c({}), c({ caseId: "A-08", bucket: "rule", passed: true, failureKind: null, missingFacts: [], forbiddenHits: [] })],
      rulesUnavailable: [c({ caseId: "A-04", mode: "rulesUnavailable", bucket: "limit", failureKind: "REFUSAL", refused: true, reason: "OUT_OF_SCOPE", missingFacts: [], forbiddenHits: [] })],
      disclaimer: "",
    };
    const html = renderToStaticMarkup(<EvalRunView d={d} />);
    const cases = html.slice(html.indexOf('data-testid="evals-cases"'), html.indexOf('data-testid="evals-ru"'));
    expect(cases.indexOf("A-01")).toBeLessThan(cases.indexOf("A-08"));
    expect(cases).toContain("8월 시책이 100만 원인데");
    expect(cases).toContain("빠진 사실: 이연");
    expect(cases).toContain("금지어: 삭감된");
    expect(cases).toMatch(/<td>내용<\/td>/);
    const buckets = html.slice(html.indexOf('data-testid="evals-buckets"'));
    for (const [label, v] of [["라인", "2/15"], ["한도", "1/12"], ["분급", "1/8"], ["규정", "9/10"], ["거부", "13/15"]]) expect(buckets).toMatch(new RegExp(`${label}</th><td class="num">${v}`));
    expect(html).toContain("47.83% (11/23)");
    expect(html).toContain("Workers AI");
    expect(html.slice(html.indexOf('data-testid="evals-ru"'))).toContain("거부 OUT_OF_SCOPE");
  });
});
