// 부록 A n=3 분산 보고(운영자 2026-11-16 — 임시 폴더가 아니라 저장소에). LLM·원격 호출 없음, 산출물 디렉터리만 읽는다.
//   node evals/scripts/variance-report.ts --ref <r1 런 디렉터리> <variance 런 디렉터리 또는 eval-out 산출물 폴더> …
//   각 인자는 summary.json·runs.jsonl이 있는 런 디렉터리이거나, 그것을 하나 담은 산출물 폴더(gh run download — run.log도 거기서 읽는다).
// 출력: 런마다 호출 수·토큰·429·축별·케이스별(기준 런 대비) → 케이스 × 런 표(normal만, rulesUnavailable은 따로) → n/N 분포(전체·축별)
//       → 같은 버전 런끼리 관문(evals/src/gate.ts 규칙 — 설계서 v0.1.46)을 돌렸을 때 거짓 실패 쌍 수, 케이스별 과반 기준과의 비교.
// 토큰: summary.json tokens(하네스 usage 기록 — 2026-11-16 PR-B 이후 런)가 있으면 그 값, 없으면 기준선 카세트(evals/vcr/eval.json)에서
//       같은 요청의 prompt_tokens(다른 요청은 3,400으로 추정 — 출력 토큰은 모름).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildReference, gate, type RefCaseRow } from "../src/gate.ts";
import { type CaseRun, type CaseScore, type EvalCase, readThresholds, type RunSummary } from "../src/score.ts";

const ROOT = join(import.meta.dirname, "../..");
const STAGE2_GUESS = 3400;

interface Loaded {
  dir: string;
  log: string | null;
  summary: { runId: string; trigger: string; startedAt: string; finishedAt?: string; calls: Record<string, number>; tokens?: Record<string, { calls: number; promptTokens: number; completionTokens: number; missing: number }>; all: RunSummary };
  rows: { run: CaseRun; score: CaseScore }[];
}

function load(arg: string): Loaded {
  let dir = arg;
  let log: string | null = null;
  if (!existsSync(join(dir, "summary.json"))) {
    const sub = readdirSync(arg).filter((x) => existsSync(join(arg, x, "summary.json")));
    if (sub.length !== 1) throw new Error(`${arg}: 런 디렉터리가 ${sub.length}개`);
    dir = join(arg, sub[0]!);
    if (existsSync(join(arg, "run.log"))) log = readFileSync(join(arg, "run.log"), "utf8");
  }
  // runs.jsonl 한 줄: {run, score}(하네스) 또는 run 칸이 맨 위에 있고 score가 옆에 붙은 꼴(--rescore 산출물) — 둘 다 받는다
  const rows = readFileSync(join(dir, "runs.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const x = JSON.parse(l) as { run?: CaseRun; score: CaseScore } & CaseRun;
      if (x.run) return { run: x.run, score: x.score };
      const { score, ...run } = x;
      return { run: run as CaseRun, score };
    });
  return { dir, log, summary: JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")) as Loaded["summary"], rows };
}

const args = process.argv.slice(2);
const refArg = args.includes("--ref") ? args[args.indexOf("--ref") + 1] : undefined;
const runArgs = args.filter((a, i) => a !== "--ref" && args[i - 1] !== "--ref");
if (!refArg || runArgs.length === 0) {
  console.error("usage: node evals/scripts/variance-report.ts --ref <기준 런> <런> …");
  process.exit(2);
}
const ref = load(refArg);
const runs = runArgs.map(load);
const cases = new Map(readFileSync(join(ROOT, "evals/cases.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => [(JSON.parse(l) as EvalCase).id, JSON.parse(l) as EvalCase]));

// ── 카세트 토큰 추정(usage 기록 전 런)
type Entry = { request: { messages: { content: string }[] }; response: { usage?: { prompt_tokens: number } } };
const section = (m: string, t: string) => new RegExp(`^<${t}>\\n([\\s\\S]*?)\\n^</${t}>$`, "m").exec(m)?.[1] ?? "";
const callKey = (calls: { tool: string; args: Record<string, string> }[]) => JSON.stringify(calls.map((c) => [c.tool, Object.entries(c.args).sort()]).sort());
const cassetteIdx = new Map<string, number>();
{
  const v = JSON.parse(readFileSync(join(ROOT, "evals/vcr/eval.json"), "utf8")) as { entries: Record<string, Entry> };
  for (const e of Object.values(v.entries)) {
    const m = e.request.messages.at(-1)!.content;
    const ru = !/^<rules>\n\[chunkId/m.test(m);
    const stage = m.includes("단계: 2단계") ? 2 : 1;
    const d = section(m, "data");
    const calls = d ? (JSON.parse(d) as { tool: string; args: Record<string, string> }[]) : [];
    cassetteIdx.set(`${section(m, "question")}|${ru}|${stage}|${stage === 2 ? callKey(calls) : ""}`, e.response.usage?.prompt_tokens ?? 0);
  }
}
function tokensOf(r: Loaded): string {
  if (r.summary.tokens) return Object.entries(r.summary.tokens).map(([p, t]) => `${p} 입력 ${t.promptTokens.toLocaleString()} · 출력 ${t.completionTokens.toLocaleString()}${t.missing ? ` (usage 없음 ${t.missing}호출)` : ""}`).join(", ");
  let sum = 0;
  let exact = 0;
  let guess = 0;
  for (const { run } of r.rows) {
    if (run.error) continue;
    const c = cases.get(run.caseId)!;
    const ru = run.mode === "rulesUnavailable";
    const s1 = cassetteIdx.get(`${c.question}|${ru}|1|`);
    if (s1 === undefined) guess++, (sum += STAGE2_GUESS);
    else exact++, (sum += s1);
    const calls = run.toolCalls ?? [];
    if (calls.length || JSON.stringify(run.violations ?? "").includes("TOOL_ARG")) {
      const s2 = cassetteIdx.get(`${c.question}|${ru}|2|${callKey(calls)}`);
      if (s2 === undefined) guess++, (sum += STAGE2_GUESS);
      else exact++, (sum += s2);
    }
  }
  return `입력 ≈ ${sum.toLocaleString()}(카세트 일치 ${exact} + 추정 ${guess}, 출력 모름)`;
}

const key = (r: CaseRun) => (r.mode === "normal" ? r.caseId : `${r.caseId}#${r.mode}`);
const byKey = (r: Loaded) => new Map(r.rows.map((x) => [key(x.run), x]));
const refMap = byKey(ref);
const mark = (s: CaseScore | undefined) => (!s ? "—" : s.passed ? "✓" : `✗${({ GROUNDING: "그라운딩", REFUSAL: "거부", TOOL: "툴", CONTENT: "내용", ERROR: "오류" } as const)[s.failureKind!]}`);
const axisLine = (a: RunSummary) => (["grounding", "refusal", "tool", "content"] as const).map((k) => `${a[k].pass}/${a[k].n}`).join(" · ");

// ── 1. 런마다
for (const r of runs) {
  const m = byKey(r);
  const n429 = r.log ? (r.log.match(/groq 429/g) ?? []).length : null;
  console.log(`\n## ${r.summary.runId} (${r.summary.trigger}, ${r.summary.startedAt} → ${r.summary.finishedAt ?? "?"})`);
  console.log(`- 호출 ${JSON.stringify(r.summary.calls)} · ${tokensOf(r)} · 429 ${n429 === null ? "run.log 없음" : n429 === 0 ? "없음" : `${n429}건`}`);
  console.log(`- normal 통과 ${r.summary.all.passed}/${r.summary.all.total} · 그라운딩 · 거부 · 툴 · 내용 = ${axisLine(r.summary.all)}`);
  const changed = [...m.values()].filter((x) => x.run.mode === "normal" && refMap.get(key(x.run))?.score.passed !== x.score.passed).map((x) => `${x.run.caseId}(${mark(refMap.get(key(x.run))?.score)} → ${mark(x.score)})`);
  console.log(`- 기준 런 ${ref.summary.runId}의 같은 normal 케이스와 통과가 달라진 것: ${changed.join(", ") || "없음"}`);
}

// ── 2. 케이스 × 런 표
const normalIds = [...byKey(runs[0]!).values()].filter((x) => x.run.mode === "normal").map((x) => x.run.caseId).sort();
const ruKeys = [...byKey(runs[0]!).keys()].filter((k) => k.includes("#")).sort();
const head = `| 케이스 | 기준 ${ref.summary.runId.slice(0, 15)}… | ${runs.map((r) => r.summary.trigger.replace("variance:", "")).join(" | ")} | ${runs.length}런 통과 |`;
const table = (keys: string[]) => {
  console.log(head);
  console.log(`|${"---|".repeat(runs.length + 3)}`);
  for (const k of keys) {
    const ss = runs.map((r) => byKey(r).get(k)?.score);
    console.log(`| ${k} | ${mark(refMap.get(k)?.score)} | ${ss.map(mark).join(" | ")} | ${ss.filter((s) => s?.passed).length}/${runs.length} |`);
  }
};
console.log(`\n## normal ${normalIds.length}건 — 기준 런 통과 ${normalIds.filter((k) => refMap.get(k)?.score.passed).length}/${normalIds.length}`);
table(normalIds);
console.log(`\n## rulesUnavailable ${ruKeys.length}건(따로 — 관문값에 넣지 않는다)`);
table(ruKeys);

// ── 3. 분포
const N = runs.length;
const dist = (pred: (s: CaseScore) => boolean | null) => {
  const out: Record<string, string[]> = {};
  for (let k = N; k >= 0; k--) out[`${k}/${N}`] = [];
  const na: string[] = [];
  for (const id of normalIds) {
    const vals = runs.map((r) => pred(byKey(r).get(id)!.score));
    if (vals.every((v) => v === null)) {
      na.push(id);
      continue;
    }
    out[`${vals.filter((v) => v === true).length}/${vals.filter((v) => v !== null).length}`] ??= [];
    out[`${vals.filter((v) => v === true).length}/${vals.filter((v) => v !== null).length}`]!.push(id);
  }
  return Object.entries(out).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.join(" ")}`).join(" · ") + (na.length ? ` · 해당 없음: ${na.join(" ")}` : "");
};
console.log(`\n## n=${N} 분포(normal)`);
console.log(`- 통과: ${dist((s) => s.passed)}`);
for (const [ax, label] of [["grounding", "그라운딩"], ["refusal", "거부"], ["tool", "툴"], ["content", "내용"]] as const) console.log(`- ${label}: ${dist((s) => s[ax])}`);

// ── 4. 같은 버전끼리 관문을 돌리면(거짓 실패) — evals/src/gate.ts 규칙 그대로(설계서 v0.1.46: R1 축별 Δ ≥ 2 · R2 안정 케이스 실패 ≥ 2 · R3 오류)
const t = readThresholds(readFileSync(join(ROOT, "evals/THRESHOLDS.md"), "utf8"));
const refRows = (r: Loaded, as60: boolean): RefCaseRow[] =>
  r.rows
    .filter((x) => x.run.mode === "normal" && normalIds.includes(x.run.caseId))
    .map((x) => ({ run_id: r.summary.runId, trigger: as60 ? "weekly" : r.summary.trigger, started_at: r.summary.startedAt, total: as60 ? 60 : r.rows.length, case_id: x.run.caseId, score: JSON.stringify(x.score), error: x.run.error ?? null }));
const candOf = (r: Loaded) => r.rows.filter((x) => x.run.mode === "normal" && normalIds.includes(x.run.caseId)).map((x) => ({ caseId: x.run.caseId, score: x.score, ...(x.run.error ? { error: x.run.error } : {}) }));
const name = (r: Loaded) => r.summary.trigger.replace("variance:", "");
const axesLine = (g: ReturnType<typeof gate>) => g.axes.map((a) => `${a.label.split(" ")[0]} ${a.ref}→${a.cur}/${a.d}`).join(" · ");
console.log(`\n## 같은 버전 런끼리 관문(gate.ts — 한 런을 60문항 기준으로 놓고, 표본 = 이 ${normalIds.length}건)`);
const all = [ref, ...runs];
let fails = 0;
let vfails = 0;
for (const a of all)
  for (const b of all) {
    if (a === b) continue;
    const g = gate(candOf(b), buildReference(refRows(a, true), normalIds), t, { runId: b.summary.runId, promptVersions: "" });
    if (!g.ok) {
      fails++;
      if (a !== ref && b !== ref) vfails++;
    }
    console.log(`- 기준 ${name(a)} → 후보 ${name(b)}: ${g.ok ? "통과" : `실패 — ${g.reasons.join("; ")}`} (${axesLine(g)})`);
  }
console.log(`- 거짓 실패 ${fails}/${all.length * (all.length - 1)}쌍 · variance끼리 ${vfails}/${runs.length * (runs.length - 1)}쌍`);
const maj = buildReference(runs.flatMap((r) => refRows(r, false)), normalIds);
console.log(`\n## 케이스별 최근 ${runs.length}회 과반 기준 — 안정 케이스: ${[...maj.values()].filter((x) => x.stable).map((x) => x.caseId).join(" ") || "없음"}`);
for (const b of all) {
  const g = gate(candOf(b), maj, t, { runId: b.summary.runId, promptVersions: "" });
  console.log(`- 과반 → 후보 ${name(b)}: ${g.ok ? "통과" : `실패 — ${g.reasons.join("; ")}`} (${axesLine(g)}; 안정 케이스 실패 ${g.stableFailed.join(" ") || "없음"})`);
}
console.log(`- 런별 통과 수(${normalIds.length}건): 기준 ${candOf(ref).filter((x) => x.score.passed).length} · ${runs.map((r) => `${name(r)} ${candOf(r).filter((x) => x.score.passed).length}`).join(" · ")}`);
