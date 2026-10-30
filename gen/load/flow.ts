// 적재·전환·되돌리기·비우기 흐름(설계서 v0.1.10 §5.1·§5.4·§14.1-10). 실행기(D1Exec)만 받는다 —
// CLI(d1.ts)는 wrangler로, 시험은 node:sqlite로 같은 흐름을 돌린다(마이그레이션 0001·0002를 그대로 적용).
import { TENANT } from "../world/rules/tables.ts";
import { countSql, estimateWrites, insertStatements, monthInvariantSql, READ_MODEL, type Row, type Slot, slotTable, sqlValue } from "./sql.ts";

/** 무료 10만 rows written/일에 "가까우면 멈춘다"의 선(설계서 §5.3, 운영자 지시 (c)). */
export const WRITE_STOP = 80_000;

export interface ExecMeta {
  changes?: number;
  rows_written?: number;
}

export interface D1Exec {
  query(sql: string): Record<string, unknown>[];
  /** 여러 문장을 차례로 적용한다(한 트랜잭션이라는 보장 없음 — 비활성 슬롯이나 문장 하나짜리에만 쓴다). */
  apply(statements: readonly string[], label: string): ExecMeta[];
}

export interface StreamInfo {
  hash: string;
  generatedAt: string;
  eventCount: number;
  planPrompt: string;
}

type Log = (line: string) => void;

interface MetaRow {
  stream_hash: string;
  slot: Slot;
  active: number;
  rid: number;
}

const other = (s: Slot): Slot => (s === "a" ? "b" : "a");

export function metaRows(db: D1Exec): { active: MetaRow | null; rows: MetaRow[] } {
  const rows = db.query("SELECT stream_hash, slot, active, rowid AS rid FROM stream_meta ORDER BY rowid") as unknown as MetaRow[];
  const a = rows.filter((r) => r.active === 1);
  if (a.length > 1) throw new Error(`active=1이 ${a.length}행 — 스키마가 막아야 하는 상태`);
  return { active: a[0] ?? null, rows };
}

export function slotCounts(db: D1Exec, slot: Slot, tenant = TENANT): Record<string, number> {
  return db.query(countSql(slot, tenant))[0] as Record<string, number>;
}

export interface Recheck {
  counts: Record<string, number>;
  monthInvariant: { month_mismatch: number; line_without_month: number; months: number; line_months: number };
  problems: string[];
}

/** ⑤ 슬롯 표 재검사: 표별 COUNT(기대값이 있으면 대조, 없으면 earnings_line > 0) + 월 합산 불변식 양방향. */
export function recheck(db: D1Exec, slot: Slot, expected: Readonly<Record<string, number>> | null, tenant = TENANT): Recheck {
  const counts = slotCounts(db, slot, tenant);
  const inv = db.query(monthInvariantSql(slot, tenant))[0] as Recheck["monthInvariant"];
  const problems = expected
    ? READ_MODEL.filter((t) => counts[t] !== expected[t]).map((t) => `${t}: D1 ${counts[t]} ≠ 기대 ${expected[t]}`)
    : counts.earnings_line! > 0
      ? []
      : ["earnings_line 0행 — 비어 있는 슬롯"];
  if (inv.month_mismatch !== 0) problems.push(`월 합산 불일치 ${inv.month_mismatch}`);
  if (inv.line_without_month !== 0) problems.push(`월 행 없는 라인 묶음 ${inv.line_without_month}`);
  return { counts, monthInvariant: inv, problems };
}

/**
 * ⑥⑦ 전환: `UPDATE stream_meta SET active = CASE WHEN stream_hash = ? THEN 1 ELSE 0 END` 한 문장 → active=1 COUNT = 1 확인.
 * active=1 부분 유일 인덱스는 행마다 검사되므로 대상 행이 활성 행보다 뒤(rowid 큼)여야 한다(v0.1.9 §5.4) — 먼저 확인한다.
 */
export function switchTo(db: D1Exec, hash: string): { n: number; hash: string; slot: Slot } {
  const order = db.query(
    `SELECT (SELECT rowid FROM stream_meta WHERE stream_hash = ${sqlValue(hash)}) AS target_rid, (SELECT rowid FROM stream_meta WHERE active = 1) AS active_rid`,
  )[0] as { target_rid: number | null; active_rid: number | null };
  if (order.target_rid === null) throw new Error(`stream_meta에 ${hash} 없음`);
  if (order.active_rid !== null && order.target_rid < order.active_rid) throw new Error(`전환 대상이 활성 행보다 먼저 들어간 행이다 ${JSON.stringify(order)} — --rollback으로`);
  db.apply([`UPDATE stream_meta SET active = CASE WHEN stream_hash = ${sqlValue(hash)} THEN 1 ELSE 0 END`], "switch");
  const n = db.query("SELECT COUNT(*) AS n, MAX(stream_hash) AS hash, MAX(slot) AS slot FROM stream_meta WHERE active = 1")[0] as { n: number; hash: string; slot: Slot };
  if (n.n !== 1 || n.hash !== hash) throw new Error(`전환 뒤 active=1 ${JSON.stringify(n)}`);
  return n;
}

/** ④에 쓰는 문장들: 슬롯 표 INSERT + stream_meta(active=0) 한 행. */
export function insertPlan(slot: Slot, info: StreamInfo, views: Readonly<Record<string, Row[]>>, verifiedAt: string, tenant = TENANT): string[] {
  const statements = READ_MODEL.flatMap((t) => insertStatements(t, slot, tenant, views[t] ?? []));
  const metaRow = [info.hash, info.generatedAt, info.eventCount, info.planPrompt, verifiedAt, 0, slot].map(sqlValue).join(", ");
  statements.push(`INSERT INTO stream_meta (stream_hash, generated_at, event_count, plan_prompt_version, verified_at, active, slot) VALUES (${metaRow});`);
  return statements;
}

export interface LoadReport {
  streamHash: string;
  slot?: Slot;
  previousActive?: string | null;
  resumed?: boolean;
  noop?: boolean;
  estimate?: ReturnType<typeof estimateWrites>;
  applyMeta?: ExecMeta[];
  check?: Recheck;
  activeAfter?: { n: number; hash: string; slot: Slot };
}

/**
 * ②~⑦ 비활성 슬롯 적재 → 재검사 → 전환. 같은 해시가 대상 슬롯에 비활성으로 이미 있고 표별 행 수가 뷰와 같으면
 * ④를 건너뛰고 ⑤부터 이어 간다(다시 넣으면 삭제 + 재적재로 rows written이 두 배). 그 밖에 대상 슬롯이 비어 있지 않으면 중단.
 */
export function loadSlot(
  db: D1Exec,
  info: StreamInfo,
  views: Readonly<Record<string, Row[]>>,
  opts: { migrationSql: string; log: Log; now?: () => string; tenant?: string },
): LoadReport {
  const tenant = opts.tenant ?? TENANT;
  const log = opts.log;
  const report: LoadReport = { streamHash: info.hash };
  const counts = Object.fromEntries(READ_MODEL.map((t) => [t, (views[t] ?? []).length]));

  const est = estimateWrites(counts, opts.migrationSql);
  report.estimate = est;
  log("적재 행 수·rows written 추정(행 × (1 + 인덱스)):");
  for (const x of est.tables) log(`  ${x.table.padEnd(22)} ${String(x.rows).padStart(6)}행 × (1 + ${x.indexes}) = ${String(x.rowsWritten).padStart(6)}`);
  log(`  합계 ${est.rows}행 → rows written 약 ${est.rowsWritten} (무료 100,000/일의 ${Math.round(est.rowsWritten / 1000)}%)`);
  if (est.rowsWritten > WRITE_STOP) throw new Error(`추정 rows written ${est.rowsWritten} > ${WRITE_STOP} — 중단(운영자 지시 (c))`);

  const { active, rows } = metaRows(db);
  if (active?.stream_hash === info.hash) {
    log(`이미 활성: ${info.hash} (slot ${active.slot}) — 할 일 없음`);
    return { ...report, noop: true };
  }
  const slot = active ? other(active.slot) : "a";
  const before = slotCounts(db, slot, tenant);
  const resumable = rows.some((x) => x.stream_hash === info.hash && x.slot === slot && x.active === 0) && READ_MODEL.every((t) => before[t] === counts[t]);
  if (!resumable && rows.some((x) => x.stream_hash === info.hash)) throw new Error(`${info.hash}가 비활성으로 이미 있는데 대상 슬롯·행 수가 맞지 않는다 ${JSON.stringify(before)} — --rollback 또는 --purge-inactive 뒤 다시 적재`);
  if (!resumable && (Object.values(before).some((n) => n > 0) || rows.some((x) => x.slot === slot))) {
    throw new Error(`대상 슬롯 ${slot}이 비어 있지 않다 ${JSON.stringify(before)} — 먼저 --purge-inactive(§14.1-10)`);
  }
  Object.assign(report, { slot, previousActive: active?.stream_hash ?? null, resumed: resumable });

  if (resumable) log(`④ 건너뜀: slot ${slot}에 ${info.hash}가 이미 적재돼 있고 표별 행 수가 뷰와 같다 → 재검사부터`);
  else {
    const statements = insertPlan(slot, info, views, (opts.now ?? (() => new Date().toISOString()))(), tenant);
    log(`④ 문장 ${statements.length}개 → slot ${slot}`);
    report.applyMeta = db.apply(statements, `load-${info.hash.slice(0, 12)}-${slot}`);
  }

  const check = recheck(db, slot, counts, tenant);
  report.check = check;
  log(`⑤ 재검사 slot ${slot}: ${JSON.stringify(check.counts)}`);
  log(`   월 합산 불변식: 월 행 ${check.monthInvariant.months}, 라인 있는 (설계사, 월) ${check.monthInvariant.line_months}, 합계 불일치 ${check.monthInvariant.month_mismatch}, 월 행 없는 라인 묶음 ${check.monthInvariant.line_without_month}`);
  if (check.problems.length) throw Object.assign(new Error(`재검사 실패 — 전환하지 않는다: ${check.problems.join("; ")}`), { report });

  report.activeAfter = switchTo(db, info.hash);
  log(`⑦ 전환 완료: active=1 ${report.activeAfter.n}행, ${report.activeAfter.hash} slot ${report.activeAfter.slot}`);
  return report;
}

/**
 * 되돌리기(v0.1.10 §5.4): 비활성 슬롯에 남아 있는 이전 스트림으로 재적재 없이 전환한다.
 * ① 그 슬롯 재검사 ② 같은 해시·같은 슬롯 행을 INSERT OR REPLACE 한 문장으로 새 rowid에 다시 넣는다(활성 행은 건드리지 않는다)
 * ③ 같은 UPDATE 한 문장으로 전환 ④ active=1 COUNT = 1 확인.
 */
export function rollback(db: D1Exec, hash: string, expected: Readonly<Record<string, number>> | null, log: Log, tenant = TENANT): LoadReport {
  const { active, rows } = metaRows(db);
  const target = rows.find((r) => r.stream_hash === hash);
  if (!target) throw new Error(`stream_meta에 ${hash} 없음 — 이전 슬롯을 이미 비웠다면 다시 적재한다`);
  if (target.active === 1) {
    log(`이미 활성: ${hash}`);
    return { streamHash: hash, slot: target.slot, noop: true };
  }
  const check = recheck(db, target.slot, expected, tenant);
  log(`① 재검사 slot ${target.slot}: ${JSON.stringify(check.counts)} 월 합산 불일치 ${check.monthInvariant.month_mismatch}`);
  if (check.problems.length) throw new Error(`되돌릴 슬롯 재검사 실패: ${check.problems.join("; ")}`);
  const [m] = db.apply(
    [
      `INSERT OR REPLACE INTO stream_meta (stream_hash, generated_at, event_count, plan_prompt_version, verified_at, active, slot)
SELECT stream_hash, generated_at, event_count, plan_prompt_version, verified_at, 0, slot FROM stream_meta WHERE stream_hash = ${sqlValue(hash)} AND active = 0`,
    ],
    "rollback-reinsert",
  );
  if (m?.changes !== undefined && m.changes < 1) throw new Error(`stream_meta 다시 넣기 영향 행 ${m.changes}`);
  log(`② stream_meta ${hash} 행을 새 rowid로 다시 넣음(slot ${target.slot})`);
  const after = switchTo(db, hash);
  log(`③④ 전환 완료: active=1 ${after.n}행, ${after.hash} slot ${after.slot} (이전 활성 ${active?.stream_hash ?? "없음"})`);
  return { streamHash: hash, slot: target.slot, previousActive: active?.stream_hash ?? null, check, activeAfter: after };
}

/** 비활성 슬롯 비우기(§14.1-10 — Phase 7 배치에서는 전환 다음 날 00:00 UTC 이후). */
export function purgeInactive(db: D1Exec, log: Log, tenant = TENANT): { slot: Slot; before: Record<string, number>; meta: ExecMeta[] } {
  const { active } = metaRows(db);
  if (!active) throw new Error("활성 스트림이 없다 — 비울 비활성 슬롯을 정할 수 없다");
  const slot = other(active.slot);
  const before = slotCounts(db, slot, tenant);
  const meta = db.apply(
    [...READ_MODEL.map((t) => `DELETE FROM ${slotTable(t, slot)} WHERE tenant_id = ${sqlValue(tenant)}`), `DELETE FROM stream_meta WHERE slot = '${slot}' AND active = 0`],
    `purge-${slot}`,
  );
  log(`purge slot ${slot}: ${JSON.stringify(before)} → rows_written ${meta.reduce((a, x) => a + (x.rows_written ?? 0), 0)}`);
  return { slot, before, meta };
}
