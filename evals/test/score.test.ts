// PHASES Phase 6 항목 3 — 4축 결정론 채점(설계서 §13.1). LLM 호출 없음.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CaseRun, type EvalCase, readThresholds, scoreCase, summarize, toolsMatch } from "../src/score";

const base: EvalCase = {
  id: "A-01",
  demoAgent: 1,
  agentId: "A-1001",
  bucket: "line",
  question: "q",
  expectedTools: [{ tool: "get_statement", args: { ym: "202608" } }],
  expectedFacts: [
    { fact: "지급 855,000", match: ["855,000", "85만 5천"], source: "" },
    { fact: "초과 145,000", match: ["145,000"], source: "" },
    { fact: "이연", match: ["이연"], source: "" },
    { fact: "채점 밖", match: ["1,800,000"], source: "" },
  ],
  expectRefusal: false,
  expectReason: null,
  misleading: false,
  forbidden: ["삭감되"],
  tags: [],
  modes: ["normal"],
  note: "",
};
const ok: CaseRun = { caseId: "A-01", mode: "normal", provider: "groq", refused: false, reason: null, groundingStatus: "PASS", text: "855,000원, 한도 초과 145,000원은 이연", toolCalls: [{ tool: "get_statement", args: { ym: "202608" } }, { tool: "get_statement", args: { ym: "202708" } }], latencyMs: 100 };

describe("scoreCase", () => {
  it("핵심 사실 앞 3개만(4번째는 채점 밖), 공백 무시, 툴은 포함 판정(추가 호출 허용)", () => {
    expect(scoreCase(base, { ...ok, text: "85만5천 원 · 145,000원 이연" })).toMatchObject({ grounding: true, refusal: true, tool: true, content: true, passed: true, failureKind: null });
  });
  it("금지어(삭감되)·빠진 사실은 CONTENT, 검증기 거부(FAIL)는 GROUNDING이고 거부 축은 통과", () => {
    expect(scoreCase(base, { ...ok, text: "855,000원 145,000원 이연 — 삭감되었습니다" })).toMatchObject({ content: false, forbiddenHits: ["삭감되"], failureKind: "CONTENT" });
    expect(scoreCase(base, { ...ok, text: "855,000원" }).missingFacts).toEqual(["초과 145,000", "이연"]);
    expect(scoreCase(base, { ...ok, refused: true, reason: "NOT_GROUNDED", groundingStatus: "FAIL", text: "보류" })).toMatchObject({ grounding: false, refusal: true, content: false, failureKind: "GROUNDING" });
  });
  it("거부 축: 거부 정답은 사유 코드까지, 거부 오답 케이스에서 모델 거부는 실패", () => {
    const r: EvalCase = { ...base, bucket: "refusal", expectedTools: [], expectedFacts: [], expectRefusal: true, expectReason: "OTHER_AGENT", forbidden: [] };
    expect(scoreCase(r, { ...ok, refused: true, reason: "OTHER_AGENT", groundingStatus: "NONE", toolCalls: [] })).toMatchObject({ refusal: true, tool: null, content: null, grounding: null, passed: true });
    expect(scoreCase(r, { ...ok, refused: true, reason: "OUT_OF_SCOPE", groundingStatus: "NONE" }).failureKind).toBe("REFUSAL");
    expect(scoreCase(base, { ...ok, refused: true, reason: "OUT_OF_SCOPE", groundingStatus: "NONE" }).failureKind).toBe("REFUSAL");
  });
  it("coreFacts 1(A-12), rulesUnavailable 모드는 내용 축 없음, 오류·미실행은 ERROR", () => {
    expect(scoreCase({ ...base, coreFacts: 1 }, { ...ok, text: "855,000" }).content).toBe(true);
    expect(scoreCase(base, { ...ok, mode: "rulesUnavailable", text: "" }).content).toBeNull();
    expect(scoreCase(base, { caseId: "A-01", mode: "normal", error: "예산" })).toMatchObject({ passed: false, failureKind: "ERROR", tool: false, content: false });
  });
  it("toolsMatch: 증권번호는 끝 4자리(0001·***0001·POL-2026-0001), 월은 그대로", () => {
    const want = [{ tool: "get_limit", args: { policyNo: "0001" } }];
    for (const p of ["0001", "***0001", "POL-2026-0001"]) expect(toolsMatch(want, [{ tool: "get_limit", args: { policyNo: p } }]), p).toBe(true);
    expect(toolsMatch(want, [{ tool: "get_limit", args: { policyNo: "0002" } }])).toBe(false);
    expect(toolsMatch([{ tool: "get_statement", args: { ym: "202608" } }], [{ tool: "get_statement", args: { ym: "202708" } }])).toBe(false);
  });
});

describe("summarize·readThresholds", () => {
  it("축별 분모는 해당 케이스만(null 제외), 비율은 소수 2자리 %", () => {
    const s = summarize([
      { run: ok, score: scoreCase(base, ok) },
      { run: ok, score: scoreCase(base, { ...ok, text: "855,000" }) },
      { run: ok, score: scoreCase({ ...base, expectedTools: [] }, ok) },
    ]);
    expect([s.total, s.passed, s.tool, s.content.rate]).toEqual([3, 2, { n: 2, pass: 2, rate: 100 }, 66.67]);
  });
  it("THRESHOLDS.md 표에서 임계치를 읽는다", () => {
    const t = readThresholds(readFileSync(join(import.meta.dirname, "../THRESHOLDS.md"), "utf8"));
    expect(t).toEqual({ grounding: 97, refusal: 90, tool: 90, content: 85, maxDropPp: 3 });
  });
});
