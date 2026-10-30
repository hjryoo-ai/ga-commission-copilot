// D1 적재(설계서 v0.1.8 §5.1·§5.4, PHASES Phase 1 항목 6).
//   pnpm run load:d1 -- --local|--remote [--stream <sha256>]     비활성 슬롯에 적재 → SQL 재검사 → UPDATE 한 문장으로 전환
//   pnpm run load:d1 -- --local|--remote --purge-inactive         비활성 슬롯 비우기(§14.1-10: 전환 다음 날 00:00 UTC 이후)
// 순서: ① data/stream/<hash>.jsonl을 projection-java로 다시 리플레이해 뷰를 얻고 meta의 뷰 해시와 대조
//       ② 적재 행 수·rows written 추정 출력(80,000 넘으면 중단) ③ 비활성 슬롯이 비었는지 확인
//       ④ INSERT 파일을 `wrangler d1 execute --file`로 적용(트랜잭션 보장 없음 — 비활성 슬롯이라 읽는 쪽에 보이지 않는다)
//       ⑤ 슬롯 표 재검사(표별 COUNT, 월 합산 불변식) ⑥ 전환 ⑦ active=1 COUNT = 1 확인
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../providers/prompt.ts";
import { TENANT } from "../world/rules/tables.ts";
import { buildReplayCli, REPLAY_BIN } from "../verify/g2.ts";
import {
  countSql,
  estimateWrites,
  insertStatements,
  loadMigration,
  monthInvariantSql,
  READ_MODEL,
  type Row,
  type Slot,
  slotTable,
  sqlValue,
} from "./sql.ts";

const OUT_DIR = join(import.meta.dirname, "../out");
const DATA_DIR = join(REPO_ROOT, "data/stream");
/** 무료 10만 rows written/일에 "가까우면 멈춘다"의 선(설계서 §5.3, 운영자 지시 (c)). */
export const WRITE_STOP = 80_000;

type Target = "--local" | "--remote";

interface D1Result {
  results: Record<string, unknown>[];
  success: boolean;
  meta?: { rows_written?: number; rows_read?: number; changes?: number };
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

const query = (target: Target, sql: string) => wrangler(target, ["--command", sql]).at(-1)!.results;

function readViews(dir: string): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const t of READ_MODEL) {
    const text = readFileSync(join(dir, `${t}.jsonl`), "utf8");
    out[t] = text.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Row);
  }
  return out;
}

function pickStream(arg: string | undefined): string {
  if (arg) return arg;
  const hashes = readdirSync(DATA_DIR).filter((f) => f.endsWith(".meta.json")).map((f) => f.slice(0, -".meta.json".length));
  if (hashes.length !== 1) throw new Error(`data/stream에 스트림이 ${hashes.length}개 — --stream <sha256>로 고른다`);
  return hashes[0]!;
}

function activeAndSlots(target: Target): { active: { hash: string; slot: Slot } | null; rows: { stream_hash: string; slot: Slot; active: number; rid: number }[] } {
  const rows = query(target, "SELECT stream_hash, slot, active, rowid AS rid FROM stream_meta ORDER BY rowid") as { stream_hash: string; slot: Slot; active: number; rid: number }[];
  const a = rows.filter((r) => r.active === 1);
  if (a.length > 1) throw new Error(`active=1이 ${a.length}행 — 스키마가 막아야 하는 상태`);
  return { active: a[0] ? { hash: a[0].stream_hash, slot: a[0].slot } : null, rows };
}

function slotCounts(target: Target, slot: Slot): Record<string, number> {
  return query(target, countSql(slot, TENANT))[0] as Record<string, number>;
}

function purgeInactive(target: Target): void {
  const { active, rows } = activeAndSlots(target);
  if (!active) throw new Error("활성 스트림이 없다 — 비울 비활성 슬롯을 정할 수 없다");
  const slot: Slot = active.slot === "a" ? "b" : "a";
  const before = slotCounts(target, slot);
  const sql = [...READ_MODEL.map((t) => `DELETE FROM ${slotTable(t, slot)} WHERE tenant_id = ${sqlValue(TENANT)};`), `DELETE FROM stream_meta WHERE slot = '${slot}' AND active = 0;`];
  const res = wrangler(target, ["--command", sql.join("\n")]);
  const written = res.reduce((a, r) => a + (r.meta?.rows_written ?? 0), 0);
  console.log(`purge slot ${slot}: ${JSON.stringify(before)} → rows_written ${written}, stream_meta ${rows.filter((r) => r.slot === slot && r.active === 0).length}행 삭제`);
}

function load(target: Target, streamArg: string | undefined): void {
  const hash = pickStream(streamArg);
  const streamPath = join(DATA_DIR, `${hash}.jsonl`);
  const meta = JSON.parse(readFileSync(join(DATA_DIR, `${hash}.meta.json`), "utf8")) as {
    generatedAt: string;
    eventCount: number;
    plan: { prompt: string };
    replay: { viewsSha256: string };
  };
  const report: Record<string, unknown> = { target, streamHash: hash };

  // ① 뷰 다시 만들기(같은 CLI — G2와 같은 정규형) + meta 대조
  const viewsDir = join(OUT_DIR, `views-${hash.slice(0, 12)}`);
  mkdirSync(viewsDir, { recursive: true });
  const buildError = buildReplayCli();
  if (buildError) throw new Error(buildError);
  const r = spawnSync(REPLAY_BIN, ["replay", streamPath, "--views", viewsDir], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`replay exit ${r.status}: ${r.stderr.slice(0, 1000)}`);
  const summary = JSON.parse(r.stdout.trim().split("\n").at(-1)!) as { viewsSha256: string; tables: Record<string, number> };
  if (summary.viewsSha256 !== meta.replay.viewsSha256) throw new Error(`뷰 해시 ${summary.viewsSha256} ≠ meta ${meta.replay.viewsSha256}`);
  const views = readViews(viewsDir);
  const counts = Object.fromEntries(READ_MODEL.map((t) => [t, views[t]!.length]));
  report.viewsSha256 = summary.viewsSha256;
  report.rows = counts;

  // ② 쓰기 예산
  const est = estimateWrites(counts, loadMigration());
  console.log("적재 행 수·rows written 추정(행 × (1 + 인덱스)):");
  for (const x of est.tables) console.log(`  ${x.table.padEnd(22)} ${String(x.rows).padStart(6)}행 × (1 + ${x.indexes}) = ${String(x.rowsWritten).padStart(6)}`);
  console.log(`  합계 ${est.rows}행 → rows written 약 ${est.rowsWritten} (무료 100,000/일의 ${Math.round(est.rowsWritten / 1000)}%)`);
  report.estimate = est;
  if (est.rowsWritten > WRITE_STOP) throw new Error(`추정 rows written ${est.rowsWritten} > ${WRITE_STOP} — 중단(운영자 지시 (c))`);

  // ③ 대상 슬롯
  const { active, rows } = activeAndSlots(target);
  if (active?.hash === hash) {
    console.log(`이미 활성: ${hash} (slot ${active.slot}) — 할 일 없음`);
    return;
  }
  const slot: Slot = active?.slot === "a" ? "b" : "a";
  const before = slotCounts(target, slot);
  // 이어서 하기: 같은 해시가 대상 슬롯에 비활성으로 이미 들어가 있고 표별 행 수가 뷰와 같으면 ④를 건너뛰고 ⑤ 재검사부터 한다
  // (다시 넣으려면 삭제 + 재적재로 rows written이 두 배가 된다). 그 밖에 대상 슬롯이 비어 있지 않으면 중단.
  const resumable = rows.some((x) => x.stream_hash === hash && x.slot === slot && x.active === 0) && READ_MODEL.every((t) => before[t] === counts[t]);
  if (!resumable && rows.some((x) => x.stream_hash === hash)) throw new Error(`${hash}가 비활성으로 이미 있는데 행 수가 다르다 ${JSON.stringify(before)} — --purge-inactive 뒤 다시 적재`);
  if (!resumable && (Object.values(before).some((n) => n > 0) || rows.some((x) => x.slot === slot))) {
    throw new Error(`대상 슬롯 ${slot}이 비어 있지 않다 ${JSON.stringify(before)} — 먼저 --purge-inactive(§14.1-10)`);
  }
  report.slot = slot;
  report.previousActive = active;
  report.resumed = resumable;
  let applied: D1Result[] = [];
  if (resumable) {
    console.log(`④ 건너뜀: slot ${slot}에 ${hash}가 이미 적재돼 있고 표별 행 수가 뷰와 같다 → 재검사부터`);
  } else {
    // ④ INSERT 파일
    const statements = READ_MODEL.flatMap((t) => insertStatements(t, slot, TENANT, views[t]!));
    const metaRow = [hash, meta.generatedAt, meta.eventCount, meta.plan.prompt, new Date().toISOString(), 0, slot].map(sqlValue).join(", ");
    statements.push(`INSERT INTO stream_meta (stream_hash, generated_at, event_count, plan_prompt_version, verified_at, active, slot) VALUES (${metaRow});`);
    const file = join(OUT_DIR, `load-${hash.slice(0, 12)}-${slot}.sql`);
    writeFileSync(file, `${statements.join("\n")}\n`);
    console.log(`④ ${file}: 문장 ${statements.length}개 → slot ${slot} (${target})`);
    applied = wrangler(target, ["--file", file]);
    report.applyMeta = applied.map((x) => ({ results: x.results, meta: x.meta ?? null }));
  }

  // ⑤ 재검사(전환 전, 슬롯 표 직접)
  const after = slotCounts(target, slot);
  const countProblems = READ_MODEL.filter((t) => after[t] !== counts[t]).map((t) => `${t}: D1 ${after[t]} ≠ 뷰 ${counts[t]}`);
  const inv = query(target, monthInvariantSql(slot, TENANT))[0] as { month_mismatch: number; line_without_month: number; months: number; line_months: number };
  report.check = { counts: after, monthInvariant: inv };
  console.log(`⑤ 재검사 slot ${slot}: ${JSON.stringify(after)}`);
  console.log(`   월 합산 불변식: 월 행 ${inv.months}, 라인 있는 (설계사, 월) ${inv.line_months}, 합계 불일치 ${inv.month_mismatch}, 월 행 없는 라인 묶음 ${inv.line_without_month}`);
  if (countProblems.length || inv.month_mismatch !== 0 || inv.line_without_month !== 0) {
    writeReport(target, report);
    throw new Error(`재검사 실패 — 전환하지 않는다: ${countProblems.join("; ")} ${JSON.stringify(inv)}`);
  }

  // ⑥ 전환: UPDATE 한 문장. active=1 부분 유일 인덱스는 행마다 검사되므로 대상 행이 활성 행보다 뒤(rowid 큼)여야 한다 — 새로 넣은 행이라 늘 그렇다
  const order = query(
    target,
    `SELECT (SELECT rowid FROM stream_meta WHERE stream_hash = ${sqlValue(hash)}) AS target_rid, (SELECT rowid FROM stream_meta WHERE active = 1) AS active_rid`,
  )[0] as { target_rid: number | null; active_rid: number | null };
  if (order.target_rid === null || (order.active_rid !== null && order.target_rid < order.active_rid)) throw new Error(`전환 대상 rowid 순서 ${JSON.stringify(order)}`);
  const sw = wrangler(target, ["--command", `UPDATE stream_meta SET active = CASE WHEN stream_hash = ${sqlValue(hash)} THEN 1 ELSE 0 END`]);
  report.switchMeta = sw.at(-1)?.meta ?? null;

  // ⑦ 확인
  const n = query(target, "SELECT COUNT(*) AS n, MAX(stream_hash) AS hash, MAX(slot) AS slot FROM stream_meta WHERE active = 1")[0] as { n: number; hash: string; slot: Slot };
  report.activeAfter = n;
  writeReport(target, report);
  if (n.n !== 1 || n.hash !== hash) throw new Error(`전환 뒤 active=1 ${JSON.stringify(n)}`);
  console.log(`⑦ 전환 완료: active=1 ${n.n}행, ${n.hash} slot ${n.slot}`);
  const written = applied.reduce((a, x) => a + (x.meta?.rows_written ?? 0), 0) + (sw.at(-1)?.meta?.rows_written ?? 0);
  console.log(`   실측 rows written(wrangler meta): 적재 ${applied.reduce((a, x) => a + (x.meta?.rows_written ?? 0), 0)} + 전환 ${sw.at(-1)?.meta?.rows_written ?? 0} = ${written}`);
}

function writeReport(target: Target, report: Record<string, unknown>): void {
  const f = join(OUT_DIR, `load.${target.slice(2)}.report.json`);
  writeFileSync(f, `${JSON.stringify(report, null, 2)}\n`);
}

function main(): void {
  const args = process.argv.slice(2);
  const target = args.includes("--remote") ? "--remote" : args.includes("--local") ? "--local" : null;
  if (!target) {
    console.error("usage: load:d1 -- --local|--remote [--stream <sha256>] | --purge-inactive");
    process.exit(2);
  }
  if (!existsSync(DATA_DIR)) throw new Error("data/stream 없음 — 먼저 pnpm run verify");
  if (args.includes("--purge-inactive")) purgeInactive(target);
  else {
    const i = args.indexOf("--stream");
    load(target, i >= 0 ? args[i + 1] : undefined);
  }
}

if (import.meta.main) main();
