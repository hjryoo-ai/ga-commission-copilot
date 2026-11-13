// 프롬프트 승격 관문(설계서 §6.3·§13.1, PHASES Phase 6 항목 4). eval-on-prompt-change.yml이 부른다.
//   node evals/src/gate.ts <summary.json> [--ref <ref.json>] [--comment <out.md>] [--enforce]
//   node evals/src/gate.ts --ref-sql <PROMPT_VERSIONS>   — 직전 활성 런 조회 SQL(60문항 런만)
// 판정: 4축 각각 THRESHOLDS.md 임계치 이상, 직전 활성 버전(ref) 대비 어느 축도 maxDropPp 이상 하락 없음,
// 그라운딩·거부는 직전 이상(§6.3). 공급자 오류·예산 미실행 케이스가 있으면 판정 불가 = 실패(다시 돌린다).
// ref.json = 원격 eval_case_result 행([{case_id, actual}]) — 같은 활성 PROMPT_VERSIONS의 가장 최근 60문항 런(baseline·weekly). 표본 케이스만 다시 집계한다.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AxisSummary, type CaseRun, type CaseScore, readThresholds, type RunSummary, summarize, type Thresholds } from "./score.ts";

export const AXES = [
  ["grounding", "그라운딩 통과율"],
  ["refusal", "거부 정확도"],
  ["tool", "툴 정확도"],
  ["content", "내용 일치"],
] as const;
type Axis = (typeof AXES)[number][0];

export interface RefRow {
  case_id: string;
  actual: string;
}

/** 원격 행에서 표본 케이스(normal 모드)만 골라 4축을 다시 센다. 기준 런에 없는 케이스는 비교에서 빠진다. */
export function refSummary(rows: readonly RefRow[], caseIds: readonly string[]): RunSummary {
  const want = new Set(caseIds);
  const scored = rows.filter((r) => want.has(r.case_id)).map((r) => {
    const a = JSON.parse(r.actual) as CaseRun & { score: CaseScore };
    return { run: a, score: a.score };
  });
  return summarize(scored);
}

/** 직전 활성 기준이 될 수 있는 런 = 60문항 전체 런(기준선·주간)만. variance(부록 A 12건)·pr·manual·stub은 표본 20건을 다 덮지 않아 기준으로 잡지 않는다(운영자 2026-11-14). */
export const REF_TRIGGERS = ["baseline", "weekly"] as const;

const PV_RE = /^[a-z_]+=v[0-9]+(,[a-z_]+=v[0-9]+)*$/;

/** PROMPT_VERSIONS 문자열 → eval_run.prompt_versions(하네스가 같은 순서의 JSON 객체로 적는다). */
export const pvJson = (pv: string) => {
  if (!PV_RE.test(pv)) throw new Error(`PROMPT_VERSIONS 형식: ${pv}`);
  return JSON.stringify(Object.fromEntries(pv.split(",").map((p) => p.split("="))));
};

/** 원격 조회 SQL(wrangler d1 execute --command) — 값은 형식 검사를 지난 PROMPT_VERSIONS와 고정 목록뿐. */
export function refQuery(basePv: string): string {
  const triggers = REF_TRIGGERS.map((t) => `'${t}'`).join(", ");
  return `SELECT r.run_id, c.case_id, c.actual FROM eval_case_result c JOIN eval_run r ON r.run_id = c.run_id WHERE r.run_id = (SELECT run_id FROM eval_run WHERE prompt_versions = '${pvJson(basePv)}' AND trigger IN (${triggers}) AND total >= 60 ORDER BY started_at DESC LIMIT 1)`;
}

export interface GateResult {
  ok: boolean;
  reasons: string[];
  markdown: string;
}

const pct = (a: AxisSummary | undefined) => (a?.rate === null || a?.rate === undefined ? "—" : `${a.rate}% (${a.pass}/${a.n})`);

export function gate(cur: RunSummary & { errors?: number }, t: Thresholds, ref: RunSummary | null, meta: { runId: string; promptVersions: string; refRunId?: string | null }): GateResult {
  const reasons: string[] = [];
  if (cur.errors) reasons.push(`공급자 오류·예산 미실행 ${cur.errors}건 — 판정 불가(다시 돌린다)`);
  const rows: string[] = [];
  for (const [k, label] of AXES) {
    const c = cur[k as Axis];
    const r = ref?.[k as Axis];
    const min = t[k as Axis];
    let mark = "";
    if (c.rate !== null && c.rate < min) {
      reasons.push(`${label} ${c.rate}% < 임계치 ${min}%`);
      mark = "✗";
    }
    let delta = "—";
    if (c.rate !== null && r && r.rate !== null) {
      const d = Math.round((c.rate - r.rate) * 100) / 100;
      delta = `${d > 0 ? "+" : ""}${d}%p`;
      if (-d >= t.maxDropPp) {
        reasons.push(`${label} 직전 대비 ${d}%p(허용 하락 < ${t.maxDropPp}%p)`);
        mark = "✗";
      } else if ((k === "grounding" || k === "refusal") && d < 0) {
        reasons.push(`${label} 직전 활성 버전 미만(${d}%p — §6.3)`);
        mark = "✗";
      }
    }
    rows.push(`| ${label} | ${pct(c)} | ≥ ${min}% | ${pct(r)} | ${delta} | ${mark || "✓"} |`);
  }
  const ok = reasons.length === 0;
  const markdown = [
    `### eval-on-prompt-change — ${ok ? "통과" : "실패"}`,
    "",
    `런 \`${meta.runId}\` · PROMPT_VERSIONS \`${meta.promptVersions}\` · 직전 활성 기준 ${meta.refRunId ? `\`${meta.refRunId}\`` : "없음(임계치만 판정)"}`,
    "",
    "| 축 | 이번 | 임계치 | 직전 활성 | 차이 | |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
    `통과 ${cur.passed}/${cur.total} · 평균 응답 ${cur.meanLatencyMs ?? "—"}ms · 20문항 표본에서 1건 = 5%p(THRESHOLDS.md)`,
    ...(ok ? [] : ["", "**실패 사유**", ...reasons.map((x) => `- ${x}`)]),
    "",
  ].join("\n");
  return { ok, reasons, markdown };
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
  const runs = readFileSync(join(dir, "runs.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as CaseRun);
  const normal = runs.filter((r) => r.mode === "normal");
  const t = readThresholds(readFileSync(join(import.meta.dirname, "../THRESHOLDS.md"), "utf8"));
  const refPath = arg("--ref");
  const refDoc = refPath ? (JSON.parse(readFileSync(refPath, "utf8")) as { runId: string | null; rows: RefRow[] }) : null;
  const ref = refDoc?.runId && refDoc.rows.length ? refSummary(refDoc.rows, normal.map((r) => r.caseId)) : null;
  const res = gate({ ...s.all, errors: normal.filter((r) => r.error).length }, t, ref, { runId: s.runId, promptVersions: s.promptVersions, refRunId: refDoc?.runId ?? null });
  const commentPath = arg("--comment");
  if (commentPath) writeFileSync(commentPath, res.markdown);
  console.log(res.markdown);
  if (args.includes("--enforce") && !res.ok) process.exit(1);
}
