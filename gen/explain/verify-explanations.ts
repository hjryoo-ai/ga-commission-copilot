// 적재 후 전수 재검증 CLI(설계서 §5.4, PHASES Phase 3 항목 4).
//   pnpm run verify:explain -- --local|--remote [--stream <sha256>]    기본은 활성 스트림. 활성 버전 PASS 행에 위반이 있으면 exit 1(이력 버전 위반은 보고만).
//   pnpm run verify:explain -- --regrade [--stream <sha256>]           data/explain의 FAIL 행(활성 버전)을 지금 검증기로 다시 판정해 통과하면 PASS로(LLM 호출 없음, 운영자 2026-11-03).
//                                                                     그 뒤 load:d1 --explain이 바뀐 행(grounding_status)을 원격에서 바꾼다.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gateExplanation } from "@copilot/grounding";
import { wranglerExec } from "../load/d1.ts";
import { pickStream, readMeta, viewsOf } from "../load/views.ts";
import { contextOf } from "./context.ts";
import { promptVersionOf } from "./generate.ts";
import { recheckExplanations } from "./recheck.ts";
import { agentRowsOf } from "./run.ts";
import { DATA_EXPLAIN, type ExplanationRecord, ExplanationStore } from "./store.ts";

export interface RegradeResult {
  label: string;
  before: ExplanationRecord["failure"];
  after: { g4: string[]; g5: string[]; g6: string[] };
  regraded: boolean;
}

/** 저장된 FAIL 행(활성 버전)을 지금 검증기로 재판정 — 통과하면 groundingStatus PASS·failure 없앰(본문·createdAt·attempts 그대로). 순수: 저장은 store.put. */
export function regrade(store: ExplanationStore, contextFor: (r: ExplanationRecord) => ReturnType<typeof contextOf>): RegradeResult[] {
  const out: RegradeResult[] = [];
  for (const r of store.all()) {
    if (r.groundingStatus !== "FAIL" || r.promptVersion !== promptVersionOf(r.kind) || !r.text) continue;
    const ctx = contextFor(r);
    if (!ctx) throw new Error(`${r.kind} ${r.agentId} ${r.subjectId}: 컨텍스트 없음`);
    const g = gateExplanation({ text: r.text, citedFields: r.citedFields, numbersUsed: r.numbersUsed }, ctx, { ownAgentId: r.agentId });
    const res = { label: `${r.kind} ${r.agentId} ${r.subjectId}`, before: r.failure, after: { g4: g.g4, g5: g.g5, g6: g.g6 }, regraded: g.status === "PASS" };
    if (res.regraded) {
      const { failure: _f, ...rest } = r;
      store.put({ ...rest, groundingStatus: "PASS" });
    }
    out.push(res);
  }
  return out;
}

function main(): void {
  const args = process.argv.slice(2);
  const hashArg = args.includes("--stream") ? args[args.indexOf("--stream") + 1] : undefined;
  if (args.includes("--regrade")) {
    const hash = pickStream(hashArg);
    const meta = readMeta(hash);
    const byAgent = new Map(agentRowsOf(viewsOf(hash, meta), meta.demoAgents!.map((d) => d.agentId)).map((r) => [r.agentId, r]));
    const results = regrade(new ExplanationStore(DATA_EXPLAIN, hash), (r) => contextOf(byAgent.get(r.agentId)!, r.kind, r.subjectId));
    console.log(`regrade ${hash.slice(0, 12)}: FAIL 행 ${results.length} → PASS로 ${results.filter((x) => x.regraded).length}`);
    for (const x of results) console.log(`  ${x.regraded ? "PASS로" : "그대로 FAIL"} ${x.label}: 전 ${JSON.stringify(x.before)} → 지금 ${JSON.stringify(x.after)}`);
    return;
  }
  const target = args.includes("--remote") ? "--remote" : args.includes("--local") ? "--local" : null;
  if (!target) {
    console.error("usage: verify:explain -- --local|--remote|--regrade [--stream <sha256>]");
    process.exit(2);
  }
  const report = recheckExplanations(wranglerExec(target), hashArg);
  const out = join(import.meta.dirname, "../out");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `verify-explain.${target.slice(2)}.report.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `explanation 재검증 ${report.streamHash.slice(0, 12)}(slot ${report.slot}${report.active ? ", 활성" : ""}): 행 ${report.rows} — PASS ${report.pass} · FAIL ${report.fail}, PASS 행 위반 ${report.violations.length}(활성 버전) · 이력 버전 위반 ${report.historyViolations.length}`,
  );
  for (const [k, v] of Object.entries(report.byKind)) console.log(`  ${k}: PASS ${v.pass} · FAIL ${v.fail}`);
  for (const v of report.violations) console.log(`  위반 ${v.kind} ${v.agentId} ${v.subjectId} ${v.promptVersion}: ${v.problems.join(" | ")}`);
  for (const v of report.historyViolations) console.log(`  이력 위반(보고만) ${v.kind} ${v.agentId} ${v.subjectId} ${v.promptVersion}: ${v.problems.join(" | ")}`);
  if (report.violations.length) process.exit(1);
}

if (import.meta.main) main();
