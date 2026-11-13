// 평가 4축 결정론 채점(설계서 §13.1, PHASES Phase 6 항목 3). LLM-as-judge 없음 — 정규화 문자열·숫자 매칭만.
// 축 정의는 evals/THRESHOLDS.md와 같다. 임계치는 THRESHOLDS.md에서 읽는다(readThresholds).

export interface EvalCase {
  id: string;
  demoAgent: 1 | 2 | 3;
  agentId: string;
  bucket: "line" | "limit" | "deferral" | "rule" | "refusal";
  question: string;
  expectedTools: { tool: string; args: Record<string, string> }[];
  expectedFacts: { fact: string; match: string[]; source: string }[];
  expectRefusal: boolean;
  expectReason: string | null;
  misleading: boolean;
  forbidden: string[];
  tags: string[];
  modes: ("normal" | "rulesUnavailable")[];
  note: string;
  /** 핵심 사실 수(기본 3, §13.1) — 부록 A가 더 적게 정한 케이스(A-12 정정 1개). */
  coreFacts?: number;
}

/** 하네스가 남기는 한 번의 실행 결과(worker AnswerResult에서 채점에 쓰는 칸 + 공급자). */
export interface CaseRun {
  caseId: string;
  mode: "normal" | "rulesUnavailable";
  /** 공급자 실패·예산 미실행이면 error. */
  error?: string;
  /** answer_log.answer_id(로컬 D1) · 끝난 시각 — 녹화·대조용. */
  answerId?: string;
  at?: string;
  /** G4·G5·G6 위반 토큰(answer_log.violations와 같은 모양) — 채점에는 쓰지 않는다. */
  violations?: unknown;
  provider?: string;
  model?: string;
  refused?: boolean;
  reason?: string | null;
  groundingStatus?: "PASS" | "FAIL" | "NONE";
  text?: string;
  toolCalls?: { tool: string; args: Record<string, string> }[];
  /** 규정 인용의 조항 표기("제17조") — 답 화면에 본문과 함께 나온다. "제N조 인용" 사실은 여기서도 찾는다. */
  citedArticles?: string[];
  rulesUnavailable?: boolean;
  latencyMs?: number;
}

/** 축 판정 — null = 이 케이스에는 해당 없음(분모에서 뺀다). */
export interface CaseScore {
  grounding: boolean | null;
  refusal: boolean;
  tool: boolean | null;
  content: boolean | null;
  passed: boolean;
  failureKind: "GROUNDING" | "REFUSAL" | "TOOL" | "CONTENT" | "ERROR" | null;
  missingFacts: string[];
  forbiddenHits: string[];
}

const MODEL_REFUSALS = new Set(["OUT_OF_SCOPE", "OTHER_AGENT", "NEEDS_ENGINE"]);

/** 비교용 정규화: 공백 제거(“14만 5천” = “14만5천”), 전각 숫자·쉼표는 그대로(매칭 목록이 표기별로 있다). */
export const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");

/** 증권번호 인자는 끝 4자리로 비교(“0001”·“***0001”·“POL-2026-0001” 모두 같은 계약 — 툴 matchPolicies와 같은 규칙). */
function argEqual(key: string, want: string, got: string | undefined): boolean {
  if (got === undefined || got === null) return false;
  if (key === "policyNo") return want.replace(/\D/g, "").slice(-4) === String(got).replace(/\D/g, "").slice(-4);
  return String(got) === want;
}

export function toolsMatch(expected: EvalCase["expectedTools"], called: NonNullable<CaseRun["toolCalls"]>): boolean {
  return expected.every((e) => called.some((c) => c.tool === e.tool && Object.entries(e.args).every(([k, v]) => argEqual(k, v, c.args?.[k]))));
}

export function scoreCase(c: EvalCase, r: CaseRun): CaseScore {
  if (r.error) return { grounding: null, refusal: false, tool: c.expectedTools.length ? false : null, content: c.expectRefusal ? null : false, passed: false, failureKind: "ERROR", missingFacts: [], forbiddenHits: [] };
  // 모델 거부 = 검증기를 거치지 않은 거부(groundingStatus NONE). 검증기가 막은 NOT_GROUNDED(FAIL)는 그라운딩 축에서 센다.
  const modelRefused = Boolean(r.refused) && r.groundingStatus === "NONE";
  const grounding = r.groundingStatus === "PASS" ? true : r.groundingStatus === "FAIL" ? false : null;
  const refusal = c.expectRefusal ? modelRefused && r.reason === c.expectReason : !(modelRefused && MODEL_REFUSALS.has(r.reason ?? ""));
  const tool = c.expectedTools.length ? toolsMatch(c.expectedTools, r.toolCalls ?? []) : null;
  let content: boolean | null = null;
  const missingFacts: string[] = [];
  const forbiddenHits: string[] = [];
  // 내용 일치(§13.1 핵심 사실 = expectedFacts 앞 coreFacts개, 기본 3). 거부 정답 케이스·rulesUnavailable 모드는 채점하지 않는다(THRESHOLDS.md)
  if (!c.expectRefusal && r.mode === "normal") {
    const text = norm(r.refused ? "" : (r.text ?? ""));
    // 사실은 본문 + 규정 인용 조항에서 찾는다(답 화면이 둘을 같이 보여 준다 — 기준선 런 검토 2026-11-13). 금지어는 본문만.
    const shown = r.refused ? text : `${text}|${norm((r.citedArticles ?? []).join("|"))}`;
    for (const f of c.expectedFacts.slice(0, c.coreFacts ?? 3)) if (!f.match.some((m) => shown.includes(norm(m)))) missingFacts.push(f.fact);
    for (const w of c.forbidden) if (text.includes(norm(w))) forbiddenHits.push(w);
    content = missingFacts.length === 0 && forbiddenHits.length === 0;
  }
  const failureKind = grounding === false ? "GROUNDING" : !refusal ? "REFUSAL" : tool === false ? "TOOL" : content === false ? "CONTENT" : null;
  return { grounding, refusal, tool, content, passed: failureKind === null, failureKind, missingFacts, forbiddenHits };
}

export interface AxisSummary {
  n: number;
  pass: number;
  rate: number | null;
}

export interface RunSummary {
  total: number;
  passed: number;
  grounding: AxisSummary;
  refusal: AxisSummary;
  tool: AxisSummary;
  content: AxisSummary;
  meanLatencyMs: number | null;
}

const axis = (xs: (boolean | null)[]): AxisSummary => {
  const ys = xs.filter((x): x is boolean => x !== null);
  const pass = ys.filter(Boolean).length;
  return { n: ys.length, pass, rate: ys.length ? Math.round((pass * 10000) / ys.length) / 100 : null };
};

export function summarize(scored: readonly { run: CaseRun; score: CaseScore }[]): RunSummary {
  const lat = scored.map((s) => s.run.latencyMs).filter((x): x is number => typeof x === "number");
  return {
    total: scored.length,
    passed: scored.filter((s) => s.score.passed).length,
    grounding: axis(scored.map((s) => s.score.grounding)),
    refusal: axis(scored.map((s) => s.score.refusal)),
    tool: axis(scored.map((s) => s.score.tool)),
    content: axis(scored.map((s) => s.score.content)),
    meanLatencyMs: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
  };
}

export interface Thresholds {
  grounding: number;
  refusal: number;
  tool: number;
  content: number;
  maxDropPp: number;
}

/** evals/THRESHOLDS.md "축과 초기값" 표에서 임계치(%)와 "직전 활성 대비 n%p" 를 읽는다. */
export function readThresholds(md: string): Thresholds {
  const pick = (label: string) => {
    const m = md.match(new RegExp(`\\| ${label} \\|[^\\n]*?\\| ≥ ([0-9.]+)% \\| ([0-9.]+)%p`));
    if (!m) throw new Error(`THRESHOLDS.md: ${label} 행 없음`);
    return { min: Number(m[1]), drop: Number(m[2]) };
  };
  const g = pick("그라운딩 통과율");
  const r = pick("거부 정확도");
  const t = pick("툴 정확도");
  const c = pick("내용 일치");
  return { grounding: g.min, refusal: r.min, tool: t.min, content: c.min, maxDropPp: Math.max(g.drop, r.drop, t.drop, c.drop) };
}
