// GET /api/v1/evals · /api/v1/evals/{runId}(설계서 §7·§8-5, PHASES Phase 6 항목 5 — 공개, 세션 없음).
// eval_run·eval_case_result(전역 운영 표)만 읽는다. 4축은 하네스가 적은 케이스별 판정(actual.score)을 세기만 한다 — 다시 채점하지 않는다.
// 기준선·관문값은 normal 모드만, rulesUnavailable 모드(case_id 접미 "#rulesUnavailable")는 따로(설계서 v0.1.40).
// 질문 문장은 골든 파일(evals/cases.jsonl — 동결, GOLDEN-REVIEW.md)에서 — eval 행에는 질문이 없다.
import { Hono } from "hono";
import goldenText from "../../../evals/cases.jsonl";
import { type EvalCaseRow, type EvalRunRow, evalCases, evalRun, evalRuns, evalRunsByTriggerPrefix } from "../db/ScopedQuery";
import { DISCLAIMER, notFound } from "./http";

export const evals = new Hono<{ Bindings: Env }>();

const RECENT = 12;
const VARIANCE_N = 3;
const TEXT_MAX = 600;
export const BUCKETS = ["line", "limit", "deferral", "rule", "refusal"] as const;

const golden: ReadonlyMap<string, string> = new Map(
  goldenText
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { id: string; question: string })
    .map((c) => [c.id, c.question]),
);

interface Score {
  grounding: boolean | null;
  refusal: boolean;
  tool: boolean | null;
  content: boolean | null;
  passed: boolean;
  failureKind: string | null;
  missingFacts: string[];
  forbiddenHits: string[];
}

interface Actual {
  caseId: string;
  mode: "normal" | "rulesUnavailable";
  error?: string;
  provider?: string;
  model?: string;
  refused?: boolean;
  reason?: string | null;
  groundingStatus?: string;
  text?: string;
  toolCalls?: { tool: string; args: Record<string, string> }[];
  citedArticles?: string[];
  violations?: unknown;
  latencyMs?: number;
  score: Score;
}

interface Expected {
  bucket: string;
  expectedTools: { tool: string; args: Record<string, string>; optional?: boolean }[];
  facts: string[];
  expectRefusal: boolean;
  expectReason: string | null;
}

export interface Axis {
  n: number;
  pass: number;
  /** 0~1(소수 넷째 자리), 분모 0이면 null. */
  rate: number | null;
}

const axis = (xs: readonly (boolean | null)[]): Axis => {
  const ys = xs.filter((x): x is boolean => x !== null);
  const pass = ys.filter(Boolean).length;
  return { n: ys.length, pass, rate: ys.length ? Math.round((pass * 10000) / ys.length) / 10000 : null };
};

interface Parsed {
  caseId: string;
  mode: Actual["mode"];
  passed: boolean;
  expected: Expected;
  actual: Actual;
  failureKind: string | null;
}

function parse(r: EvalCaseRow): Parsed {
  const actual = JSON.parse(r.actual) as Actual;
  const [caseId, mode] = r.case_id.split("#") as [string, string | undefined];
  return { caseId, mode: mode === "rulesUnavailable" ? "rulesUnavailable" : "normal", passed: r.passed === 1, expected: JSON.parse(r.expected) as Expected, actual, failureKind: r.failure_kind };
}

export function axes(cases: readonly Parsed[]) {
  return {
    total: cases.length,
    passed: cases.filter((c) => c.passed).length,
    grounding: axis(cases.map((c) => c.actual.score.grounding)),
    refusal: axis(cases.map((c) => c.actual.score.refusal)),
    tool: axis(cases.map((c) => c.actual.score.tool)),
    content: axis(cases.map((c) => c.actual.score.content)),
  };
}

const promptVersions = (s: string): Record<string, string> => {
  try {
    return JSON.parse(s) as Record<string, string>;
  } catch {
    return {};
  }
};

function runSummary(r: EvalRunRow, cases: readonly Parsed[]) {
  const normal = cases.filter((c) => c.mode === "normal");
  const a = axes(normal);
  return {
    runId: r.run_id,
    startedAt: r.started_at,
    trigger: r.trigger,
    promptVersions: promptVersions(r.prompt_versions),
    streamHash: r.stream_hash,
    model: r.model,
    total: r.total ?? a.total,
    passed: r.passed ?? a.passed,
    // eval_run 열이 있는 3축은 그 값, 내용 일치는 열이 없어(§5.1) 케이스 판정에서 센다
    rates: { grounding: r.grounding_pass_rate, refusal: r.refusal_accuracy, tool: r.tool_accuracy, content: a.content.rate },
    meanLatencyMs: r.mean_latency_ms,
    rulesUnavailable: { total: cases.length - normal.length, passed: cases.filter((c) => c.mode !== "normal" && c.passed).length },
  };
}

/** 부록 A n=3(설계서 v0.1.37): 가장 최근 variance 런과 같은 PROMPT_VERSIONS의 최근 3런, 케이스별 통과 횟수. */
function variance(runs: readonly EvalRunRow[], cases: readonly (Parsed & { runId: string })[]) {
  if (runs.length === 0) return null;
  const pv = runs[0]!.prompt_versions;
  const same = runs.filter((r) => r.prompt_versions === pv).slice(0, VARIANCE_N);
  const ids = new Set(same.map((r) => r.run_id));
  const byCase = new Map<string, (boolean | null)[]>();
  const order = [...same].reverse(); // 오래된 것부터
  for (const c of cases) if (ids.has(c.runId) && c.mode === "normal" && !byCase.has(c.caseId)) byCase.set(c.caseId, order.map(() => null));
  for (const c of cases) {
    if (!ids.has(c.runId) || c.mode !== "normal") continue;
    byCase.get(c.caseId)![order.findIndex((r) => r.run_id === c.runId)] = c.passed;
  }
  const rows = [...byCase.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([caseId, results]) => ({ caseId, question: golden.get(caseId) ?? null, results, passes: results.filter((x) => x === true).length, n: results.filter((x) => x !== null).length }));
  return {
    promptVersions: promptVersions(pv),
    runs: order.map((r) => ({ runId: r.run_id, startedAt: r.started_at, trigger: r.trigger })),
    cases: rows,
    // 런 수가 n=3에 못 미치면 분포는 지금까지의 n 기준
    distribution: Object.fromEntries(Array.from({ length: same.length + 1 }, (_, k) => [String(same.length - k), rows.filter((r) => r.n === same.length && r.passes === same.length - k).length])),
  };
}

evals.get("/", async (c) => {
  const [runs, vRuns] = await Promise.all([evalRuns(c.env.DB, RECENT), evalRunsByTriggerPrefix(c.env.DB, "variance:", 10)]);
  const vSame = vRuns.filter((r) => r.prompt_versions === vRuns[0]?.prompt_versions).slice(0, VARIANCE_N);
  const ids = [...new Set([...runs.map((r) => r.run_id), ...vSame.map((r) => r.run_id)])];
  const rows = (await evalCases(c.env.DB, ids)).map((r) => ({ ...parse(r), runId: r.run_id }));
  const byRun = new Map<string, Parsed[]>();
  for (const r of rows) (byRun.get(r.runId) ?? byRun.set(r.runId, []).get(r.runId)!).push(r);
  return c.json(
    { runs: runs.map((r) => runSummary(r, byRun.get(r.run_id) ?? [])), variance: variance(vSame, rows), disclaimer: DISCLAIMER },
    200,
    { "Cache-Control": "public, max-age=60" },
  );
});

evals.get("/:runId", async (c) => {
  const run = await evalRun(c.env.DB, c.req.param("runId"));
  if (!run) return notFound(c);
  const parsed = (await evalCases(c.env.DB, [run.run_id])).map(parse);
  const normal = parsed.filter((p) => p.mode === "normal");
  const providers = [...new Set(normal.map((p) => p.actual.provider ?? "none"))].sort();
  const item = (p: Parsed) => ({
    caseId: p.caseId,
    mode: p.mode,
    bucket: p.expected.bucket,
    question: golden.get(p.caseId) ?? null,
    passed: p.passed,
    failureKind: p.failureKind,
    provider: p.actual.provider ?? null,
    refused: p.actual.refused ?? null,
    reason: p.actual.reason ?? null,
    groundingStatus: p.actual.groundingStatus ?? null,
    text: p.actual.text === undefined ? null : p.actual.text.slice(0, TEXT_MAX),
    toolCalls: p.actual.toolCalls ?? [],
    error: p.actual.error ?? null,
    latencyMs: p.actual.latencyMs ?? null,
    expectedTools: p.expected.expectedTools,
    facts: p.expected.facts,
    expectRefusal: p.expected.expectRefusal,
    expectReason: p.expected.expectReason,
    missingFacts: p.actual.score.missingFacts,
    forbiddenHits: p.actual.score.forbiddenHits,
    violations: p.actual.violations ?? null,
  });
  // 실패 우선(설계서 §8-5), 그 안에서 케이스 번호 순
  const ordered = (xs: Parsed[]) => [...xs].sort((a, b) => Number(a.passed) - Number(b.passed) || a.caseId.localeCompare(b.caseId)).map(item);
  return c.json(
    {
      run: runSummary(run, parsed),
      byProvider: Object.fromEntries(providers.map((p) => [p, axes(normal.filter((x) => (x.actual.provider ?? "none") === p))])),
      byBucket: BUCKETS.map((b) => {
        const xs = normal.filter((p) => p.expected.bucket === b);
        return { bucket: b, total: xs.length, passed: xs.filter((p) => p.passed).length };
      }),
      cases: ordered(normal),
      rulesUnavailable: ordered(parsed.filter((p) => p.mode !== "normal")),
      disclaimer: DISCLAIMER,
    },
    200,
    { "Cache-Control": "public, max-age=60" },
  );
});
