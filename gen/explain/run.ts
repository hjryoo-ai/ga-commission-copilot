// 설명 사전 생성 CLI(설계서 v0.1.14 §4.1(b), PHASES Phase 3 항목 2·3).
//   node explain/run.ts --stub     VCR 16건만 재생 → gen/out/explain/<hash>/ (커밋 안 함). 녹화 없는 subject는 건너뛴다.
//   node explain/run.ts --record   VCR 16건을 Groq 실호출로 녹화(dev 예산) + data/explain/<hash>/에도 쓴다(같은 키는 배치가 건너뜀).
//   node explain/run.ts --batch    data/explain/<hash>/에 없는 subject를 LINE → LIMIT → MONTH_DIFF 순으로 생성.
//                                  Groq(batch:explain:groq 130/일) → Workers AI gpt-oss-20b(batch:explain:workers-ai 200/일), 소진되면 멈춘다.
//   공통: [--stream <sha256>] [--limit N]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Json } from "@copilot/grounding";
import { BudgetExhausted, reserveCall, reserveDevCall } from "../providers/budget.ts";
import { openStub, replay, type VcrEntry, type VcrFile, vcrPath, writeVcr } from "../providers/cassette.ts";
import { type ProviderName, ProviderError, structured } from "../providers/groq.ts";
import { pickStream, readMeta, viewsOf } from "../load/views.ts";
import { TENANT } from "../world/rules/tables.ts";
import { type AgentRows, contextOf, type Kind, type Row, subjectsOf } from "./context.ts";
import { type Caller, generateOne, labelOf, promptVersionOf, type Subject } from "./generate.ts";
import { DATA_EXPLAIN, type ExplanationRecord, ExplanationStore, OUT_EXPLAIN } from "./store.ts";

export const VCR_NAME = "explain";
/** 배치 공급자 순서와 하루 상한(설계서 v0.1.14 §4.1(b)·§10.4). */
export const BATCH_PROVIDERS: readonly { provider: ProviderName; scope: string; cap: number; model?: string; spacingMs: number }[] = [
  { provider: "groq", scope: "batch:explain:groq", cap: 130, spacingMs: 15_000 }, // TPM 8K ÷ 호출당 약 2K
  { provider: "workers-ai", scope: "batch:explain:workers-ai", cap: 200, model: "@cf/openai/gpt-oss-20b", spacingMs: 1_000 },
];
const RECORD_SPACING_MS = 15_000;
/** 429의 retry-after가 이보다 길면 그 공급자는 그날 끝(TPD·RPD)으로 본다. */
const LONG_WAIT_S = 120;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 뷰 행 → 데모 설계사별 AgentRows. */
export function agentRowsOf(views: Readonly<Record<string, Row[]>>, agentIds: readonly string[]): AgentRows[] {
  const pick = (t: string, a: string) => (views[t] ?? []).filter((r) => r.agent_id === a);
  return agentIds.map((a) => {
    const ledgers = new Set(pick("policy_limit", a).map((l) => l.ledger_id));
    return {
      agentId: a,
      earnings_line: pick("earnings_line", a),
      earnings_month: pick("earnings_month", a),
      policy_limit: pick("policy_limit", a),
      policy_limit_history: (views.policy_limit_history ?? []).filter((h) => ledgers.has(h.ledger_id)),
      deferral_item: pick("deferral_item", a),
      clawback_item: pick("clawback_item", a),
    };
  });
}

export function allSubjects(rows: readonly AgentRows[]): Subject[] {
  const per = rows.map((r) => subjectsOf(r).map((s) => ({ tenantId: TENANT, agentId: r.agentId, ...s })));
  // 순서: 종류(LINE → LIMIT → MONTH_DIFF) 먼저, 그 안에서 데모 번호·설계사 내 순서
  return (["LINE", "LIMIT", "MONTH_DIFF"] as Kind[]).flatMap((k) => per.flatMap((xs) => xs.filter((s) => s.kind === k)));
}

/**
 * 시험용 VCR 16건(설계서 v0.1.14 §4.1(b)): LINE 10·LIMIT 3·MONTH_DIFF 3, 결정론.
 * LINE: A-1 예약 라인 1·2·6(부록 A-01·A-12 골든) → 특징별 첫 라인(분급 원천, DEFERRED, 환수 채권, 취소 짝, 데모 2·3의 RENEWAL·FY_COMM)으로 10건.
 * LIMIT: A-1 원장 1(부록 A-02·A-03) + 데모 2·3에서 이력·분급이 가장 많은 원장. MONTH_DIFF: 데모 1은 202702(부록 A-06), 2·3은 유형이 가장 많은 달.
 */
export function vcrSubjects(rows: readonly AgentRows[]): Subject[] {
  const S = (agentId: string, kind: Kind, subjectId: string): Subject => ({ tenantId: TENANT, agentId, kind, subjectId });
  const out: Subject[] = [];
  const has = (k: Kind, id: string, a: string) => out.some((s) => s.kind === k && s.subjectId === id && s.agentId === a);
  const lines = rows.flatMap((r) => [...r.earnings_line].sort((x, y) => Number(x.source_seq) - Number(y.source_seq)).map((l) => ({ a: r.agentId, l, r })));
  for (const id of ["1", "2", "6"]) {
    const x = lines.find((y) => y.l.calc_id === id);
    if (x) out.push(S(x.a, "LINE", id));
  }
  const features: ((x: (typeof lines)[number]) => boolean)[] = [
    (x) => x.r.deferral_item.some((d) => d.source_calc_id === x.l.calc_id),
    (x) => x.l.comm_type === "DEFERRED",
    (x) => x.r.clawback_item.some((c) => c.origin_calc_id === x.l.calc_id),
    (x) => typeof x.l.reversal_of_calc_id === "string",
    (x) => x.a === rows[1]?.agentId && x.l.comm_type === "RENEWAL",
    (x) => x.a === rows[2]?.agentId && x.l.comm_type === "RENEWAL",
    (x) => x.a === rows[2]?.agentId && x.l.comm_type === "FY_COMM",
    (x) => x.a === rows[1]?.agentId && x.l.comm_type === "FY_COMM",
    (x) => x.l.comm_type === "CLAWBACK",
  ];
  for (const f of features) {
    if (out.length >= 10) break;
    const x = lines.find((y) => f(y) && !has("LINE", String(y.l.calc_id), y.a));
    if (x) out.push(S(x.a, "LINE", String(x.l.calc_id)));
  }
  const a1 = rows.find((r) => r.policy_limit.some((l) => l.ledger_id === "1"));
  if (a1) out.push(S(a1.agentId, "LIMIT", "1"));
  for (const r of rows.slice(1)) {
    const weight = (l: Row) => r.policy_limit_history.filter((h) => h.ledger_id === l.ledger_id).length * 10 + r.deferral_item.filter((d) => d.policy_no === l.policy_no).length;
    const best = [...r.policy_limit].sort((x, y) => weight(y) - weight(x) || String(x.ledger_id).localeCompare(String(y.ledger_id)))[0];
    if (best) out.push(S(r.agentId, "LIMIT", String(best.ledger_id)));
  }
  for (const r of rows) {
    const months = subjectsOf(r).filter((s) => s.kind === "MONTH_DIFF");
    // 데모 1은 A-1 해약 환수 달 202702(부록 A-06)
    if (r === a1 && months.some((m) => m.subjectId === "202702")) {
      out.push(S(r.agentId, "MONTH_DIFF", "202702"));
      continue;
    }
    const types = (ym: string) => new Set(r.earnings_line.filter((l) => l.close_ym === ym).map((l) => l.comm_type)).size;
    const best = [...months].sort((x, y) => types(y.subjectId) - types(x.subjectId) || x.subjectId.localeCompare(y.subjectId))[0];
    if (best) out.push(S(r.agentId, "MONTH_DIFF", best.subjectId));
  }
  return out;
}

function loadStream(arg: string | undefined) {
  const hash = pickStream(arg);
  const meta = readMeta(hash);
  if (!meta.demoAgents || meta.demoAgents.length !== 3) throw new Error(`${hash.slice(0, 12)}: meta.demoAgents 3명 없음 — pnpm run verify`);
  const views = viewsOf(hash, meta);
  const rows = agentRowsOf(views, meta.demoAgents.map((d) => d.agentId));
  return { hash, rows, byAgent: new Map(rows.map((r) => [r.agentId, r])) };
}

function contextFor(byAgent: Map<string, AgentRows>, s: Subject): Json {
  const ctx = contextOf(byAgent.get(s.agentId)!, s.kind, s.subjectId);
  if (!ctx) throw new Error(`${labelOf(s)}: 컨텍스트 없음`);
  return ctx;
}

interface Tally {
  pass: number;
  fail: number;
  /** 재생성 없이 첫 시도에 G1·G4·G5·G6을 통과한 수. */
  firstPass: number;
}

export interface RunReport {
  mode: string;
  streamHash: string;
  subjects: number;
  skippedCached: number;
  generated: Tally & { byKind: Record<string, Tally>; byProvider: Record<string, Tally> };
  /** 공급자에 실제로 보낸 HTTP 요청 수(예산 차감 수와 같다 — 재시도 포함). */
  calls: Record<string, number>;
  /** 같은 요청을 다시 보낸 사유별 수(`groq:json_validate_failed`·`groq:429`·`workers-ai:5xx` …). */
  providerRetries: Record<string, number>;
  stoppedBy?: string;
  failures: { label: string; provider: string; failure: ExplanationRecord["failure"] }[];
}

const emptyTally = (): Tally => ({ pass: 0, fail: 0, firstPass: 0 });

function newReport(mode: string, streamHash: string, subjects: number): RunReport {
  return { mode, streamHash, subjects, skippedCached: 0, generated: { ...emptyTally(), byKind: {}, byProvider: {} }, calls: {}, providerRetries: {}, failures: [] };
}

function tally(report: RunReport, r: ExplanationRecord) {
  for (const t of [report.generated, (report.generated.byKind[r.kind] ??= emptyTally()), (report.generated.byProvider[r.provider] ??= emptyTally())]) {
    if (r.groundingStatus === "PASS") t.pass++;
    else t.fail++;
    if (r.groundingStatus === "PASS" && r.attempts === 1) t.firstPass++;
  }
  if (r.groundingStatus === "FAIL") report.failures.push({ label: labelOf(r), provider: r.provider, failure: r.failure });
}

/** --stub: VCR 재생. */
export async function runStub(hash: string, byAgent: Map<string, AgentRows>, subjects: Subject[], store: ExplanationStore): Promise<RunReport> {
  const src = openStub(VCR_NAME);
  if (src.kind !== "vcr") throw new Error("explain VCR 없음 — --record 먼저");
  const report = newReport("stub", hash, subjects.length);
  const recorded = new Set(Object.keys(src.file.entries));
  const call: Caller = async ({ label, hash: h }) => {
    report.calls.vcr = (report.calls.vcr ?? 0) + 1;
    const e = (src.file as VcrFile).entries[label]!;
    return { json: replay(src, label, h), provider: "vcr", model: e.model, at: e.recordedAt };
  };
  for (const s of subjects) {
    if (!recorded.has(labelOf(s))) continue;
    const r = await generateOne(s, hash, contextFor(byAgent, s), call);
    store.put(r);
    tally(report, r);
  }
  return report;
}

/** 공급자가 구조화 출력을 만들지 못한 400(Groq json_validate_failed — 빈 출력, 같은 요청을 다시 보내면 대개 통과한다). */
const isJsonFailure = (e: ProviderError) => e.status === 400 && e.message.includes("json_validate_failed");

/**
 * 실호출(시도마다 예산 차감 → 공급자 호출). 429면 기다리거나 그 공급자를 끝내고, 5xx·구조화 출력 실패(400)는 같은 요청을 다시 보낸다(최대 3회).
 * 3회 모두 구조화 출력 실패면 json=null을 돌려준다 — 호출자의 G1이 실패로 판정해 재생성·FAIL 경로를 탄다(배치가 멈추지 않는다).
 */
async function liveCall(provider: ProviderName, reserve: () => void, req: Parameters<typeof structured>[1], report: RunReport): Promise<{ json: unknown; model: string }> {
  const retry = (why: string) => {
    const k = `${provider}:${why}`;
    report.providerRetries[k] = (report.providerRetries[k] ?? 0) + 1;
  };
  let jsonFailures = 0;
  for (let i = 0; i < 3; i++) {
    reserve();
    report.calls[provider] = (report.calls[provider] ?? 0) + 1;
    try {
      const r = await structured(provider, req);
      return { json: r.json, model: r.model };
    } catch (e) {
      if (e instanceof ProviderError && e.status === 429) {
        const wait = e.retryAfterSeconds ?? 30;
        if (wait > LONG_WAIT_S) throw new BudgetExhausted(`${provider} 429 retry-after ${wait}s — 그날 한도`);
        retry("429");
        console.warn(`[live] ${provider} 429, ${wait + 1}s 대기`);
        await sleep((wait + 1) * 1000);
        continue;
      }
      if (e instanceof ProviderError && e.status >= 500) {
        retry("5xx");
        console.warn(`[live] ${provider} ${e.status}, 10s 뒤 다시`);
        await sleep(10_000);
        continue;
      }
      if (e instanceof ProviderError && isJsonFailure(e)) {
        jsonFailures++;
        retry("json_validate_failed");
        console.warn(`[live] ${provider} 구조화 출력 실패(400 json_validate_failed), 같은 요청 다시`);
        await sleep(5_000);
        continue;
      }
      throw e;
    }
  }
  if (jsonFailures === 3) return { json: null, model: req.model };
  throw new Error(`${provider}: 3회 실패`);
}

/** --record: VCR 16건 녹화(Groq, dev 예산) + data/explain에도 기록. */
export async function runRecord(hash: string, byAgent: Map<string, AgentRows>, subjects: Subject[], store: ExplanationStore): Promise<RunReport> {
  const previous: Record<string, VcrEntry> = existsSync(vcrPath(VCR_NAME)) ? (JSON.parse(readFileSync(vcrPath(VCR_NAME), "utf8")) as VcrFile).entries : {};
  // 이번 녹화에 쓰인 항목만 남긴다(프롬프트가 바뀌어 안 쓰이게 된 옛 항목·옛 #retry는 버린다)
  const entries: Record<string, VcrEntry> = {};
  const report = newReport("record", hash, subjects.length);
  let n = 0;
  const call: Caller = async ({ label, attempt, req, hash: h }) => {
    const prev = previous[label];
    if (prev && prev.requestHash === h) {
      entries[label] = prev;
      writeVcr(VCR_NAME, entries);
      return { json: prev.response, provider: "groq", model: prev.model, at: prev.recordedAt };
    }
    if (n++ > 0) await sleep(RECORD_SPACING_MS);
    const r = await liveCall("groq", () => reserveDevCall(), req, report);
    const at = new Date().toISOString();
    entries[label] = { requestHash: h, repairs: attempt, model: r.model, recordedAt: at, usage: null, response: r.json };
    writeVcr(VCR_NAME, entries);
    return { json: r.json, provider: "groq", model: r.model, at };
  };
  for (const s of subjects) {
    const r = await generateOne(s, hash, contextFor(byAgent, s), call);
    store.put(r);
    tally(report, r);
    console.log(`[record] ${labelOf(s)} ${r.groundingStatus}${r.attempts === 2 ? " (재생성)" : ""}`);
  }
  return report;
}

/** --batch: 캐시에 없는 subject를 공급자 순서·하루 상한대로. */
export async function runBatch(hash: string, byAgent: Map<string, AgentRows>, subjects: Subject[], store: ExplanationStore, limit: number): Promise<RunReport> {
  const report = newReport("batch", hash, subjects.length);
  const pending = subjects.filter((s) => {
    const cached = store.has({ ...s, promptVersion: promptVersionOf(s.kind) });
    if (cached) report.skippedCached++;
    return !cached;
  });
  let p = 0;
  let done = 0;
  for (const s of pending) {
    if (done >= limit) {
      report.stoppedBy = `--limit ${limit}`;
      break;
    }
    let record: ExplanationRecord | null = null;
    while (!record && p < BATCH_PROVIDERS.length) {
      const bp = BATCH_PROVIDERS[p]!;
      const call: Caller = async ({ req }) => {
        const r = await liveCall(bp.provider, () => reserveCall(bp.scope, bp.cap), req, report);
        await sleep(bp.spacingMs);
        return { json: r.json, provider: bp.provider, model: r.model };
      };
      try {
        record = await generateOne(s, hash, contextFor(byAgent, s), call, bp.model);
      } catch (e) {
        if (!(e instanceof BudgetExhausted)) throw e;
        console.warn(`[batch] ${bp.provider} 끝: ${e.message}`);
        p++;
      }
    }
    if (!record) {
      report.stoppedBy = "모든 공급자 예산 소진(오늘)";
      break;
    }
    store.put(record);
    tally(report, record);
    done++;
    console.log(`[batch] ${labelOf(s)} ${record.groundingStatus} ${record.provider}${record.attempts === 2 ? " (재생성)" : ""}`);
  }
  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const mode = args.includes("--stub") ? "stub" : args.includes("--record") ? "record" : args.includes("--batch") ? "batch" : null;
  if (!mode) {
    console.error("usage: explain -- --stub|--record|--batch [--stream <sha256>] [--limit N]");
    process.exit(2);
  }
  const limit = Number(arg("--limit") ?? Number.MAX_SAFE_INTEGER);
  const { hash, rows, byAgent } = loadStream(arg("--stream"));
  const all = allSubjects(rows);
  const vcr = vcrSubjects(rows);
  console.log(`stream ${hash.slice(0, 12)} — subjects ${all.length} (LINE ${all.filter((s) => s.kind === "LINE").length} · LIMIT ${all.filter((s) => s.kind === "LIMIT").length} · MONTH_DIFF ${all.filter((s) => s.kind === "MONTH_DIFF").length}), VCR ${vcr.length}`);
  let report: RunReport;
  if (mode === "stub") report = await runStub(hash, byAgent, vcr, new ExplanationStore(OUT_EXPLAIN, hash));
  else if (mode === "record") report = await runRecord(hash, byAgent, vcr, new ExplanationStore(DATA_EXPLAIN, hash));
  else report = await runBatch(hash, byAgent, all, new ExplanationStore(DATA_EXPLAIN, hash), limit);
  const outDir = join(import.meta.dirname, "../out");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `explain.${mode}.report.json`), `${JSON.stringify(report, null, 2)}\n`);
  const g = report.generated;
  const pct = (n: number, d: number) => (d ? `${((n * 1000) / d / 10).toFixed(1)}%` : "-");
  const line = (t: Tally) => `PASS ${t.pass} · FAIL ${t.fail} — 첫 시도 ${t.firstPass}/${t.pass + t.fail}(${pct(t.firstPass, t.pass + t.fail)}) · 재생성 후 ${pct(t.pass, t.pass + t.fail)}`;
  console.log(`${mode}: 생성 ${g.pass + g.fail}(${line(g)}), 캐시 건너뜀 ${report.skippedCached}, 호출 ${JSON.stringify(report.calls)}, 재시도 ${JSON.stringify(report.providerRetries)}${report.stoppedBy ? `, 멈춤: ${report.stoppedBy}` : ""}`);
  for (const [k, v] of Object.entries(g.byKind)) console.log(`  ${k}: ${line(v)}`);
  for (const [k, v] of Object.entries(g.byProvider)) console.log(`  ${k}: ${line(v)}`);
  for (const f of report.failures) console.log(`  FAIL ${f.label} ${f.provider} ${JSON.stringify(f.failure)}`);
}

if (import.meta.main) await main();
