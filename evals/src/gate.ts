// 프롬프트 승격 관문(설계서 §6.3·§13.1 — v0.1.46 케이스별 기준·건수 허용, PHASES Phase 6 항목 4). eval-on-prompt-change.yml이 부른다.
//   node evals/src/gate.ts <summary.json> [--ref <ref.json>] [--comment <out.md>] [--enforce]
//   node evals/src/gate.ts --ref-sql <PROMPT_VERSIONS>   — 기준 행 조회 SQL(같은 버전의 60문항·재채점·variance·pr 런, normal 케이스)
// 기준(운영자 2026-11-17): 케이스마다 같은 PROMPT_VERSIONS의 최근 실행 3회(재채점이 있으면 원본 대신 최신 재채점) — 3회 이상이면
//   축별·통과 과반(동수는 미통과), 모자라면 그 버전의 최신 60문항 런(재채점 우선) 값. 기준 보강용 실행은 따로 돌리지 않는다.
// 판정(PR 표본 20건): R1 축마다 기준 케이스 집합 D_k(기준 값이 있는 케이스)에서 Δ_k = 기준 통과 수 − 이번 통과 수 ≥ 2면 실패(1건분까지 통과)
//   · R2 안정 케이스(기준 3회 모두 통과) 중 이번 실패 ≥ 2면 실패 · R3 공급자 오류·미실행이 있으면 판정 불가 = 실패.
//   절대 관문값(THRESHOLDS.md — 60문항 율)은 PR 표본에 적용하지 않고 60문항 런에만 표시한다(실패로 세지 않는다 — 다음 60문항 런에서도 미달이면 되돌리는 PR).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CaseRun, type CaseScore, readThresholds, type RunSummary, type Thresholds } from "./score.ts";

export const AXES = [
  ["grounding", "그라운딩 통과율"],
  ["refusal", "거부 정확도"],
  ["tool", "툴 정확도"],
  ["content", "내용 일치"],
] as const;
export type Axis = (typeof AXES)[number][0];

/** R1 허용: 축마다 기준보다 이 건수 이상 낮으면 실패(1건분까지 통과). R2: 안정 케이스 실패가 이 건수 이상이면 실패. */
export const AXIS_DROP_FAIL = 2;
export const STABLE_FAIL = 2;
/** 과반에 쓰는 케이스별 최근 실행 수. */
export const MAJORITY_RUNS = 3;

/** 60문항 런 trigger(기준 대체값 — 케이스 자료가 3회 미만일 때). */
export const REF_TRIGGERS = ["baseline", "weekly", "rescore:baseline", "rescore:weekly"] as const;

/** 원격 기준 행(refQuery 결과 한 줄). score는 eval_case_result.actual의 score(JSON 문자열), error는 미실행·공급자 오류. */
export interface RefCaseRow {
  run_id: string;
  trigger: string;
  started_at: string;
  total: number;
  case_id: string;
  score: string | null;
  error: string | null;
}

export type AxisValues = Record<Axis, boolean | null>;

export interface CaseRef {
  caseId: string;
  /** "majority"(최근 3회 과반) 또는 그 값을 준 60문항 런 run_id. */
  source: string;
  runs: string[];
  axes: AxisValues;
  passed: boolean;
  /** 기준 실행(3회) 모두에서 통과 — R2 대상. 60문항 런 한 번이면 false. */
  stable: boolean;
}

const PV_RE = /^[a-z_]+=v[0-9]+(,[a-z_]+=v[0-9]+)*$/;

/** PROMPT_VERSIONS 문자열 → eval_run.prompt_versions(하네스가 같은 순서의 JSON 객체로 적는다). */
export const pvJson = (pv: string) => {
  if (!PV_RE.test(pv)) throw new Error(`PROMPT_VERSIONS 형식: ${pv}`);
  return JSON.stringify(Object.fromEntries(pv.split(",").map((p) => p.split("="))));
};

/** 원격 조회 SQL(wrangler d1 execute --command) — 값은 형식 검사를 지난 PROMPT_VERSIONS와 고정 목록뿐. stub·manual 런은 기준이 아니다. */
export function refQuery(basePv: string): string {
  const triggers = REF_TRIGGERS.map((t) => `'${t}'`).join(", ");
  return [
    "SELECT r.run_id, r.trigger, r.started_at, r.total, c.case_id, json_extract(c.actual, '$.score') AS score, json_extract(c.actual, '$.error') AS error",
    "FROM eval_case_result c JOIN eval_run r ON r.run_id = c.run_id",
    `WHERE r.prompt_versions = '${pvJson(basePv)}' AND (r.trigger IN (${triggers}) OR r.trigger LIKE 'variance:%' OR r.trigger LIKE 'pr:%') AND c.case_id NOT LIKE '%#%'`,
    "ORDER BY r.started_at DESC, r.run_id DESC",
  ].join(" ");
}

const pick = (s: CaseScore): AxisValues => ({ grounding: s.grounding, refusal: s.refusal, tool: s.tool, content: s.content });
/** 과반: 값이 있는 실행 중 통과가 절반 초과면 true, 동수·미만이면 false, 값이 없으면 null. */
const majority = (vs: readonly (boolean | null)[]): boolean | null => {
  const x = vs.filter((v): v is boolean => v !== null);
  return x.length ? x.filter(Boolean).length * 2 > x.length : null;
};
const byRecent = (a: RefCaseRow, b: RefCaseRow) => (a.started_at === b.started_at ? b.run_id.localeCompare(a.run_id) : b.started_at.localeCompare(a.started_at));

/** 기준 행 → 케이스별 기준. 재채점 런이 있으면 그 원본(run_id에서 -r<n>을 뗀 것)과 더 오래된 재채점은 뺀다(같은 답을 두 번 세지 않는다). */
export function buildReference(rows: readonly RefCaseRow[], caseIds: readonly string[]): Map<string, CaseRef> {
  const rescoreOf = new Map<string, string>();
  for (const r of rows) {
    if (!r.trigger.startsWith("rescore:")) continue;
    const orig = r.run_id.replace(/-r\d+$/, "");
    const cur = rescoreOf.get(orig);
    if (!cur || r.run_id.localeCompare(cur) > 0) rescoreOf.set(orig, r.run_id);
  }
  const dropped = new Set([...rescoreOf.keys(), ...rows.filter((r) => r.trigger.startsWith("rescore:") && rescoreOf.get(r.run_id.replace(/-r\d+$/, "")) !== r.run_id).map((r) => r.run_id)]);
  const usable = rows.filter((r) => !dropped.has(r.run_id) && !r.error && r.score);
  const out = new Map<string, CaseRef>();
  for (const id of caseIds) {
    const mine = usable.filter((r) => r.case_id === id).sort(byRecent);
    if (mine.length >= MAJORITY_RUNS) {
      const used = mine.slice(0, MAJORITY_RUNS);
      const ss = used.map((r) => JSON.parse(r.score!) as CaseScore);
      const axes = Object.fromEntries(AXES.map(([k]) => [k, majority(ss.map((s) => s[k]))])) as AxisValues;
      out.set(id, { caseId: id, source: "majority", runs: used.map((r) => r.run_id), axes, passed: majority(ss.map((s) => s.passed)) ?? false, stable: ss.every((s) => s.passed) });
      continue;
    }
    const full = mine.find((r) => r.total >= 60 && (REF_TRIGGERS as readonly string[]).includes(r.trigger));
    if (!full) continue;
    const s = JSON.parse(full.score!) as CaseScore;
    out.set(id, { caseId: id, source: full.run_id, runs: [full.run_id], axes: pick(s), passed: s.passed, stable: false });
  }
  return out;
}

export interface AxisCount {
  axis: Axis;
  label: string;
  /** D_k = 기준 값이 있는 표본 케이스 수. */
  d: number;
  ref: number;
  cur: number;
  drop: number;
}

export interface GateResult {
  ok: boolean;
  reasons: string[];
  axes: AxisCount[];
  stableFailed: string[];
  /** 60문항 런에서 절대 관문값 미달(표시만 — 실패로 세지 않는다). */
  belowThresholds: string[];
  markdown: string;
}

/**
 * 관문(v0.1.46). cur = 이번 런의 normal 케이스별 점수(표본), refs = buildReference 결과.
 * R1: Δ_k = Σ_{c∈D_k} [기준_k(c)] − Σ_{c∈D_k} [이번_k(c)] (이번 값이 null이면 미통과로 센다), Δ_k ≥ 2면 실패.
 */
export function gate(
  cur: readonly { caseId: string; score: CaseScore; error?: string }[],
  refs: ReadonlyMap<string, CaseRef>,
  t: Thresholds,
  meta: { runId: string; promptVersions: string; summary?: RunSummary },
): GateResult {
  const reasons: string[] = [];
  const errors = cur.filter((c) => c.error).length;
  if (errors) reasons.push(`R3 공급자 오류·예산 미실행 ${errors}건 — 판정 불가(다시 돌린다)`);
  const axes: AxisCount[] = AXES.map(([k, label]) => {
    const inD = cur.filter((c) => refs.get(c.caseId)?.axes[k] !== null && refs.has(c.caseId));
    const ref = inD.filter((c) => refs.get(c.caseId)!.axes[k] === true).length;
    const now = inD.filter((c) => c.score[k] === true).length;
    return { axis: k, label, d: inD.length, ref, cur: now, drop: ref - now };
  });
  for (const a of axes) if (a.drop >= AXIS_DROP_FAIL) reasons.push(`R1 ${a.label} 기준 ${a.ref}/${a.d} → 이번 ${a.cur}/${a.d}(${a.drop}건 하락 — ${AXIS_DROP_FAIL}건 이상이면 실패)`);
  const stable = cur.filter((c) => refs.get(c.caseId)?.stable);
  const stableFailed = stable.filter((c) => !c.score.passed).map((c) => c.caseId);
  if (stableFailed.length >= STABLE_FAIL) reasons.push(`R2 안정 케이스 ${stableFailed.length}/${stable.length}건 실패: ${stableFailed.join(", ")}`);
  const s = meta.summary;
  const belowThresholds = s && s.total >= 60 ? AXES.filter(([k]) => s[k].rate !== null && s[k].rate! < t[k]).map(([k, label]) => `${label} ${s[k].rate}% < 관문값 ${t[k]}%`) : [];
  const ok = reasons.length === 0;
  const majorityCases = cur.filter((c) => refs.get(c.caseId)?.source === "majority").map((c) => c.caseId);
  const singleRuns = [...new Set(cur.map((c) => refs.get(c.caseId)?.source).filter((x): x is string => !!x && x !== "majority"))];
  const noRef = cur.filter((c) => !refs.has(c.caseId)).map((c) => c.caseId);
  const markdown = [
    `### eval-on-prompt-change — ${ok ? "통과" : "실패"}`,
    "",
    `런 \`${meta.runId}\` · PROMPT_VERSIONS \`${meta.promptVersions}\``,
    `기준: 최근 ${MAJORITY_RUNS}회 과반 ${majorityCases.length}건${majorityCases.length ? `(${majorityCases.join(" ")})` : ""} · 60문항 런${singleRuns.length ? ` ${singleRuns.map((r) => `\`${r}\``).join(", ")}` : ""} ${cur.length - majorityCases.length - noRef.length}건${noRef.length ? ` · 기준 없음 ${noRef.length}건(${noRef.join(" ")} — 비교에서 뺐다)` : ""}`,
    "",
    "| 축 | 기준 통과 / D | 이번 통과 / D | 차이(건) | R1 |",
    "|---|---|---|---|---|",
    ...axes.map((a) => `| ${a.label} | ${a.ref}/${a.d} | ${a.cur}/${a.d} | ${a.drop > 0 ? `−${a.drop}` : a.drop < 0 ? `+${-a.drop}` : "0"} | ${a.drop >= AXIS_DROP_FAIL ? "✗" : "✓"} |`),
    "",
    `R2 안정 케이스(기준 ${MAJORITY_RUNS}회 모두 통과) ${stable.length}건 중 이번 실패 ${stableFailed.length}건${stableFailed.length ? `: ${stableFailed.join(", ")}` : ""} — ${STABLE_FAIL}건 이상이면 실패`,
    `통과 ${cur.filter((c) => c.score.passed).length}/${cur.length}${errors ? ` · 오류·미실행 ${errors}건` : ""}. 절대 관문값(THRESHOLDS.md)은 60문항 런에만 표시한다${belowThresholds.length ? ` — **미달**: ${belowThresholds.join("; ")}` : ""}.`,
    ...(ok ? [] : ["", "**실패 사유**", ...reasons.map((x) => `- ${x}`)]),
    "",
  ].join("\n");
  return { ok, reasons, axes, stableFailed, belowThresholds, markdown };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const refSql = arg("--ref-sql");
  if (refSql !== undefined) {
    console.log(refQuery(refSql));
    process.exit(0);
  }
  const summaryPath = args[0];
  if (!summaryPath) throw new Error("summary.json 경로");
  const dir = join(summaryPath, "..");
  const s = JSON.parse(readFileSync(summaryPath, "utf8")) as { runId: string; promptVersions: string; all: RunSummary };
  // runs.jsonl 한 줄 = CaseRun 칸 + score
  const runs = readFileSync(join(dir, "runs.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as CaseRun & { score: CaseScore });
  const normal = runs.filter((r) => r.mode === "normal").map((r) => ({ caseId: r.caseId, score: r.score, ...(r.error ? { error: r.error } : {}) }));
  const t = readThresholds(readFileSync(join(import.meta.dirname, "../THRESHOLDS.md"), "utf8"));
  const refPath = arg("--ref");
  const rows = refPath ? (JSON.parse(readFileSync(refPath, "utf8")) as { rows: RefCaseRow[] }).rows : [];
  const res = gate(normal, buildReference(rows, normal.map((c) => c.caseId)), t, { runId: s.runId, promptVersions: s.promptVersions, summary: s.all });
  const commentPath = arg("--comment");
  if (commentPath) writeFileSync(commentPath, res.markdown);
  console.log(res.markdown);
  if (args.includes("--enforce") && !res.ok) process.exit(1);
}
