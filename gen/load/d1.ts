// D1 적재 CLI(설계서 v0.1.11 §5.1·§5.4, PHASES Phase 1 항목 6). 흐름은 flow.ts, 여기는 wrangler 실행기와 projection-java 뷰 재생성.
//   pnpm run load:d1 -- --local|--remote [--stream <sha256>]     비활성 슬롯에 적재 → SQL 재검사 → UPDATE 한 문장으로 전환
//   pnpm run load:d1 -- --local|--remote --rollback <sha256>      비활성 슬롯에 남은 이전 스트림으로 재적재 없이 되돌리기
//   pnpm run load:d1 -- --local|--remote --purge-inactive         비활성 슬롯 비우기(§14.1-10: 전환 다음 날 00:00 UTC 이후)
//   pnpm run load:d1 -- --local|--remote --explain [--stream <sha256>] [--dir <dir>]   설명 적재(v0.1.14 §4.1(b) — 기본 data/explain, 없는 키만)
// 적재는 ① data/stream/<hash>.jsonl을 projection-java로 다시 리플레이해 뷰를 얻고 meta의 뷰 해시와 대조한 뒤 flow.loadSlot(②~⑦).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../providers/prompt.ts";
import { type D1Exec, type ExecMeta, type ExplanationInput, loadExplanations, loadSlot, purgeInactive, rollback } from "./flow.ts";
import { loadMigration } from "./sql.ts";
import { DATA_DIR, pickStream, readMeta, viewsOf } from "./views.ts";

const OUT_DIR = join(import.meta.dirname, "../out");
/** --command 한 번에 넘길 SQL 길이 상한. 넘으면 --file. */
const COMMAND_MAX = 50_000;

type Target = "--local" | "--remote";

interface D1Result {
  results: Record<string, unknown>[];
  success: boolean;
  meta?: { rows_written?: number; changes?: number };
}

function wrangler(target: Target, args: string[]): D1Result[] {
  const r = spawnSync("pnpm", ["--dir", join(REPO_ROOT, "worker"), "exec", "wrangler", "d1", "execute", "copilot", target, "--json", "--yes", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`wrangler d1 execute 실패(exit ${r.status}): ${(r.stderr || r.stdout).trim().slice(0, 2000)}`);
  // 원격 --file은 --json이어도 업로드 진행 문구를 먼저 찍는다 — JSON 배열이 시작하는 줄부터 읽는다
  const start = r.stdout.search(/^\[/m);
  if (start < 0) throw new Error(`wrangler 출력에 JSON이 없다: ${r.stdout.slice(0, 500)}`);
  return JSON.parse(r.stdout.slice(start)) as D1Result[];
}

export function wranglerExec(target: Target): D1Exec {
  return {
    query: (sql) => wrangler(target, ["--command", sql]).at(-1)!.results,
    apply(statements, label): ExecMeta[] {
      const sql = statements.map((s) => s.replace(/;\s*$/, "")).join(";\n");
      let res: D1Result[];
      if (sql.length <= COMMAND_MAX) res = wrangler(target, ["--command", sql]);
      else {
        const file = join(OUT_DIR, `${label}.sql`);
        writeFileSync(file, `${sql};\n`);
        res = wrangler(target, ["--file", file]);
      }
      // 원격 --file은 meta.rows_written이 0이고 results[0]["Rows written"]에 실측이 있다
      return res.map((x) => ({ changes: x.meta?.changes, rows_written: x.meta?.rows_written || Number(x.results[0]?.["Rows written"] ?? 0) }));
    },
  };
}

function writeReport(target: Target, kind: string, report: unknown): void {
  writeFileSync(join(OUT_DIR, `${kind}.${target.slice(2)}.report.json`), `${JSON.stringify(report, null, 2)}\n`);
}

function main(): void {
  const args = process.argv.slice(2);
  const target = args.includes("--remote") ? "--remote" : args.includes("--local") ? "--local" : null;
  if (!target) {
    console.error("usage: load:d1 -- --local|--remote [--stream <sha256>] | --rollback <sha256> | --purge-inactive");
    process.exit(2);
  }
  const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const db = wranglerExec(target);
  const log = (l: string) => console.log(l);
  mkdirSync(OUT_DIR, { recursive: true });

  if (args.includes("--explain")) {
    const hash = pickStream(arg("--stream"));
    const dir = join(arg("--dir") ?? join(REPO_ROOT, "data/explain"), hash);
    if (!existsSync(dir)) throw new Error(`${dir} 없음 — pnpm run explain 먼저`);
    const records = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as ExplanationInput));
    const report = loadExplanations(db, hash, records, log);
    writeReport(target, "explain", report);
    log(`   실측 rows written(wrangler): ${report.meta.reduce((a, x) => a + (x.rows_written ?? 0), 0)}`);
    return;
  }
  if (args.includes("--purge-inactive")) {
    writeReport(target, "purge", purgeInactive(db, log));
    return;
  }
  const rollbackHash = arg("--rollback");
  if (rollbackHash) {
    // data/stream에 그 스트림이 있으면 뷰 행 수로 대조하고, 없으면 월 합산·비어 있지 않음만 본다
    const expected = existsSync(join(DATA_DIR, `${rollbackHash}.meta.json`))
      ? Object.fromEntries(Object.entries(viewsOf(rollbackHash, readMeta(rollbackHash))).map(([t, rows]) => [t, rows.length]))
      : null;
    writeReport(target, "rollback", rollback(db, rollbackHash, expected, log));
    return;
  }
  if (!existsSync(DATA_DIR)) throw new Error("data/stream 없음 — 먼저 pnpm run verify");
  const hash = pickStream(arg("--stream"));
  const meta = readMeta(hash);
  const views = viewsOf(hash, meta);
  try {
    const report = loadSlot(db, { hash, generatedAt: meta.generatedAt, eventCount: meta.eventCount, planPrompt: meta.plan.prompt, demoAgents: meta.demoAgents ?? [] }, views, {
      migrationSql: loadMigration(),
      log,
    });
    writeReport(target, "load", report);
    const written = (report.applyMeta ?? []).reduce((a, x) => a + (x.rows_written ?? 0), 0);
    if (report.applyMeta) log(`   실측 rows written(wrangler): 적재 ${written}`);
  } catch (e) {
    const report = (e as { report?: unknown }).report;
    if (report) writeReport(target, "load", report);
    throw e;
  }
}

if (import.meta.main) main();
