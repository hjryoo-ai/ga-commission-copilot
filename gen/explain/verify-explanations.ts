// 적재 후 전수 재검증 CLI(설계서 §5.4, PHASES Phase 3 항목 4).
//   pnpm run verify:explain -- --local|--remote [--stream <sha256>]    기본은 활성 스트림. 위반이 있으면 exit 1.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { wranglerExec } from "../load/d1.ts";
import { recheckExplanations } from "./recheck.ts";

function main(): void {
  const args = process.argv.slice(2);
  const target = args.includes("--remote") ? "--remote" : args.includes("--local") ? "--local" : null;
  if (!target) {
    console.error("usage: verify:explain -- --local|--remote [--stream <sha256>]");
    process.exit(2);
  }
  const hash = args.includes("--stream") ? args[args.indexOf("--stream") + 1] : undefined;
  const report = recheckExplanations(wranglerExec(target), hash);
  const out = join(import.meta.dirname, "../out");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `verify-explain.${target.slice(2)}.report.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `explanation 재검증 ${report.streamHash.slice(0, 12)}(slot ${report.slot}${report.active ? ", 활성" : ""}): 행 ${report.rows} — PASS ${report.pass} · FAIL ${report.fail}, PASS 행 위반 ${report.violations.length}`,
  );
  for (const [k, v] of Object.entries(report.byKind)) console.log(`  ${k}: PASS ${v.pass} · FAIL ${v.fail}`);
  for (const v of report.violations) console.log(`  위반 ${v.kind} ${v.agentId} ${v.subjectId} ${v.promptVersion}: ${v.problems.join(" | ")}`);
  if (report.violations.length) process.exit(1);
}

if (import.meta.main) main();
