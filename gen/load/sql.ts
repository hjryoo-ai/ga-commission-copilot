// D1 적재 SQL 생성(설계서 v0.1.8 §5.1·§5.3, PHASES Phase 1 항목 6). 순수 함수만 — 실행은 d1.ts.
// 행은 projection-java `replay --views`의 정규형(열 이름 = DB 열 이름, tenant_id 제외)을 그대로 쓴다: D1 = 상위 프로젝터 뷰.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../providers/prompt.ts";

/** 읽기 모델 8표(recon_result는 D1에 없다 — 설계서 §5.1). 적재·삭제 순서. */
export const READ_MODEL = [
  "agent_profile",
  "earnings_line",
  "earnings_month",
  "policy_limit",
  "policy_limit_history",
  "deferral_item",
  "clawback_item",
  "policy_flag",
] as const;
export type ReadModelTable = (typeof READ_MODEL)[number];
export type Slot = "a" | "b";

/** D1 SQL 문장 최대 길이 100KB(D1 limits) 아래로 여유를 둔다. */
export const MAX_STATEMENT_BYTES = 90_000;

export type Row = Record<string, unknown>;

export function slotTable(table: string, slot: Slot): string {
  if (slot !== "a" && slot !== "b") throw new Error(`invalid slot ${slot}`);
  return `${table}_${slot}`;
}

/** SQL 리터럴. 금액·정수는 안전 정수만(규약 8 — 실수 금지), JSON 열(객체·배열)은 문자열로. */
export function sqlValue(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error(`정수가 아닌 수 ${v}`);
    return String(v);
  }
  if (typeof v === "string") return `'${v.replaceAll("'", "''")}'`;
  if (typeof v === "object") return sqlValue(JSON.stringify(v));
  throw new Error(`SQL 값으로 못 바꾸는 형 ${typeof v}`);
}

/** 다중 행 INSERT 문장들(문장마다 MAX_STATEMENT_BYTES 이하). 모든 행의 열 집합이 같아야 한다. */
export function insertStatements(table: string, slot: Slot, tenant: string, rows: readonly Row[]): string[] {
  if (rows.length === 0) return [];
  const cols = Object.keys(rows[0]!);
  for (const r of rows) {
    const k = Object.keys(r);
    if (k.length !== cols.length || k.some((c, i) => c !== cols[i])) throw new Error(`${table}: 행마다 열이 다르다`);
  }
  const head = `INSERT INTO ${slotTable(table, slot)} (tenant_id, ${cols.join(", ")}) VALUES\n`;
  const out: string[] = [];
  let tuples: string[] = [];
  let bytes = Buffer.byteLength(head);
  for (const r of rows) {
    const t = `(${[sqlValue(tenant), ...cols.map((c) => sqlValue(r[c]))].join(", ")})`;
    const b = Buffer.byteLength(t) + 2;
    if (Buffer.byteLength(head) + b > MAX_STATEMENT_BYTES) throw new Error(`${table}: 한 행이 문장 한도를 넘는다`);
    if (tuples.length && bytes + b > MAX_STATEMENT_BYTES) {
      out.push(`${head}${tuples.join(",\n")};`);
      tuples = [];
      bytes = Buffer.byteLength(head);
    }
    tuples.push(t);
    bytes += b;
  }
  out.push(`${head}${tuples.join(",\n")};`);
  return out;
}

/**
 * 표마다 행 1개를 쓸 때 함께 쓰이는 인덱스 수(마이그레이션 0002의 슬롯 a 정의에서 센다):
 * PRIMARY KEY(INTEGER 단일 PK가 아니면 자동 인덱스) + UNIQUE + CREATE INDEX. D1은 인덱스 쓰기를 rows written에 더한다(D1 pricing).
 */
export function indexesPerRow(migrationSql: string, table: string): number {
  const m = migrationSql.match(new RegExp(`CREATE TABLE ${table}_a \\(([\\s\\S]*?)\\) STRICT;`));
  if (!m) throw new Error(`0002에 ${table}_a 없음`);
  const body = m[1]!;
  const pk = /PRIMARY KEY \(/.test(body) ? 1 : 0;
  const unique = (body.match(/\bUNIQUE \(/g) ?? []).length;
  const explicit = (migrationSql.match(new RegExp(`CREATE (?:UNIQUE )?INDEX \\w+ ON ${table}_a \\(`, "g")) ?? []).length;
  return pk + unique + explicit;
}

export function loadMigration(): string {
  return readFileSync(join(REPO_ROOT, "worker/migrations/0002_ab_slots.sql"), "utf8");
}

export interface WriteEstimate {
  table: string;
  rows: number;
  indexes: number;
  rowsWritten: number;
}

/** 적재 rows written 추정 = 행 수 × (1 + 인덱스 수). stream_meta 1행(PK·유일 인덱스 2)도 더한다. */
export function estimateWrites(counts: Readonly<Record<string, number>>, migrationSql: string): { tables: WriteEstimate[]; rows: number; rowsWritten: number } {
  const tables: WriteEstimate[] = READ_MODEL.map((t) => {
    const rows = counts[t] ?? 0;
    const indexes = indexesPerRow(migrationSql, t);
    return { table: t, rows, indexes, rowsWritten: rows * (1 + indexes) };
  });
  tables.push({ table: "stream_meta", rows: 1, indexes: 3, rowsWritten: 4 });
  return { tables, rows: tables.reduce((a, x) => a + x.rows, 0), rowsWritten: tables.reduce((a, x) => a + x.rowsWritten, 0) };
}

/** 슬롯 표별 행 수 — 한 행, 열 이름 = 표 이름. D1은 compound SELECT 항 수를 제한해 UNION ALL 대신 스칼라 서브쿼리로 센다. */
export function countSql(slot: Slot, tenant: string): string {
  return `SELECT ${READ_MODEL.map((t) => `(SELECT COUNT(*) FROM ${slotTable(t, slot)} WHERE tenant_id = ${sqlValue(tenant)}) AS ${t}`).join(",\n  ")}`;
}

/**
 * 상위 §5 불변식 1(월 합산 = Σ 라인)을 양방향으로: 월 행의 gross·clawback_offset·adjustment가 그 달 라인 합과 다르거나,
 * 라인은 있는데 월 행이 없으면 위반. 합계만 쓴다(CLAUDE.md 규약 2 — 합계는 허용).
 */
export function monthInvariantSql(slot: Slot, tenant: string): string {
  const line = slotTable("earnings_line", slot);
  const month = slotTable("earnings_month", slot);
  const t = sqlValue(tenant);
  return `WITH l AS (
  SELECT agent_id, close_ym,
         SUM(CASE WHEN comm_type NOT IN ('CLAWBACK', 'ADJUSTMENT') THEN amount ELSE 0 END) AS gross,
         SUM(CASE WHEN comm_type = 'CLAWBACK' THEN amount ELSE 0 END) AS clawback_offset,
         SUM(CASE WHEN comm_type = 'ADJUSTMENT' THEN amount ELSE 0 END) AS adjustment
  FROM ${line} WHERE tenant_id = ${t} GROUP BY agent_id, close_ym
)
SELECT
  (SELECT COUNT(*) FROM ${month} m LEFT JOIN l ON l.agent_id = m.agent_id AND l.close_ym = m.close_ym
    WHERE m.tenant_id = ${t} AND (m.gross <> COALESCE(l.gross, 0) OR m.clawback_offset <> COALESCE(l.clawback_offset, 0) OR m.adjustment <> COALESCE(l.adjustment, 0))) AS month_mismatch,
  (SELECT COUNT(*) FROM l WHERE NOT EXISTS (SELECT 1 FROM ${month} m WHERE m.tenant_id = ${t} AND m.agent_id = l.agent_id AND m.close_ym = l.close_ym)) AS line_without_month,
  (SELECT COUNT(*) FROM ${month} WHERE tenant_id = ${t}) AS months,
  (SELECT COUNT(*) FROM l) AS line_months`;
}
