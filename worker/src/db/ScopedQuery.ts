// D1 접근의 유일한 통로(CLAUDE.md 규약 3, 설계서 v0.1.10 §5.1, PHASES Phase 2 항목 2).
// - ScopedQuery: 생성자에서 tenant_id·agent_id·활성 스트림(슬롯)을 받고, 모든 SQL에 `tenant_id = ? AND agent_id = ?`를 붙여 바인딩한다.
// - 읽기 모델 8표는 A/B 슬롯 두 벌이다. 슬롯 표 이름은 이 파일의 slotTable()만 만든다 — 다른 코드에는 슬롯 접미 리터럴이 없다(아키텍처 테스트).
// - 활성 슬롯은 stream_meta(전역 표, 테넌트 열 없음)의 active=1 한 행. 요청마다 읽는다 — 슬롯을 캐시하면 전환 뒤에도 옛 슬롯을 읽는다.
//   isolate 캐시는 stream_hash를 키로 한 파생 값만(cachedForStream).
// 식별자(표·열·정렬)는 허용 목록·패턴으로 막고, 값은 전부 바인딩한다.

/** 데모 테넌트(gen/world/rules/tables.ts TENANT와 같은 값 — worker는 gen을 import하지 않는다). */
export const DEMO_TENANT = "T1";

export type Slot = "a" | "b";

export interface ActiveStream {
  streamHash: string;
  slot: Slot;
}

/** 읽기 모델 8표(설계서 §5.1). */
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

const IDENT = /^[a-z][a-z0-9_]*$/;
type Value = string | number | null;
type Op = "=" | "<" | "<=" | ">" | ">=";

export interface SelectOptions {
  columns: readonly string[];
  /** 열 → 값(=) 또는 [연산자, 값]. tenant_id·agent_id는 넣지 않는다(생성자 값이 붙는다). */
  where?: Readonly<Record<string, Value | readonly [Op, Value]>>;
  /** "열" 또는 "열 DESC"를 쉼표로. */
  orderBy?: string;
  limit?: number;
}

const isPair = (v: Value | readonly [Op, Value]): v is readonly [Op, Value] => Array.isArray(v);

function slotTable(table: ReadModelTable, slot: Slot): string {
  if (!(READ_MODEL as readonly string[]).includes(table)) throw new Error("unknown read-model table");
  if (slot !== "a" && slot !== "b") throw new Error("invalid slot");
  return `${table}_${slot}`;
}

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`invalid identifier ${JSON.stringify(name)}`);
  return name;
}

function orderBy(spec: string): string {
  return spec
    .split(",")
    .map((part) => {
      const m = part.trim().match(/^([a-z][a-z0-9_]*)(?:\s+(ASC|DESC))?$/i);
      if (!m) throw new Error(`invalid order by ${JSON.stringify(spec)}`);
      return m[2] ? `${m[1]} ${m[2].toUpperCase()}` : m[1]!;
    })
    .join(", ");
}

export class ScopedQuery {
  readonly tenantId: string;
  readonly agentId: string;
  readonly stream: ActiveStream;
  private readonly db: D1Database;

  constructor(db: D1Database, scope: { tenantId: string; agentId: string; stream: ActiveStream }) {
    if (!scope.tenantId || !scope.agentId) throw new Error("tenantId·agentId 필수");
    slotTable("earnings_line", scope.stream.slot); // 슬롯 값 검사
    this.db = db;
    this.tenantId = scope.tenantId;
    this.agentId = scope.agentId;
    this.stream = scope.stream;
  }

  /** SELECT … FROM <표>_<슬롯> WHERE tenant_id = ? AND agent_id = ? [AND …] [ORDER BY …] [LIMIT n] — 문장과 바인딩 값. */
  build(table: ReadModelTable, opts: SelectOptions): { sql: string; params: Value[] } {
    if (opts.columns.length === 0) throw new Error("columns 비어 있음");
    const params: Value[] = [this.tenantId, this.agentId];
    const conds = ["tenant_id = ?", "agent_id = ?"];
    for (const [col, v] of Object.entries(opts.where ?? {})) {
      if (col === "tenant_id" || col === "agent_id") throw new Error("tenant_id·agent_id는 생성자 값만 쓴다");
      const [op, value]: readonly [Op, Value] = isPair(v) ? v : ["=", v];
      if (!["=", "<", "<=", ">", ">="].includes(op)) throw new Error(`invalid operator ${op}`);
      conds.push(`${ident(col)} ${op} ?`);
      params.push(value);
    }
    let sql = `SELECT ${opts.columns.map(ident).join(", ")} FROM ${slotTable(table, this.stream.slot)} WHERE ${conds.join(" AND ")}`;
    if (opts.orderBy) sql += ` ORDER BY ${orderBy(opts.orderBy)}`;
    if (opts.limit !== undefined) {
      if (!Number.isSafeInteger(opts.limit) || opts.limit < 1) throw new Error("invalid limit");
      sql += ` LIMIT ${opts.limit}`;
    }
    return { sql, params };
  }

  async all<T>(table: ReadModelTable, opts: SelectOptions): Promise<T[]> {
    const { sql, params } = this.build(table, opts);
    return (await this.db.prepare(sql).bind(...params).all<T>()).results;
  }

  async first<T>(table: ReadModelTable, opts: SelectOptions): Promise<T | null> {
    const { sql, params } = this.build(table, { ...opts, limit: 1 });
    return this.db.prepare(sql).bind(...params).first<T>();
  }
}

// ─── 설계사 범위 밖의 접근(전역 표·연결 확인·테넌트 집계) — 행을 내주지 않는 것만 둔다 ─────────────────

/** 활성 스트림. 첫 적재 전이면 null. stream_meta는 테넌트 열이 없는 전역 표다. */
export async function activeStream(db: D1Database): Promise<ActiveStream | null> {
  const row = await db.prepare("SELECT stream_hash, slot FROM stream_meta WHERE active = 1").first<{ stream_hash: string; slot: Slot }>();
  return row ? { streamHash: row.stream_hash, slot: row.slot } : null;
}

/** D1 연결 확인(SELECT 1). */
export async function ping(db: D1Database): Promise<number | null> {
  return (await db.prepare("SELECT 1 AS one").first<{ one: number }>())?.one ?? null;
}

/**
 * /health용 테넌트 집계: 활성 슬롯 earnings_line의 행 수(행은 내주지 않는다). 설계사 조건이 없는 유일한 읽기 모델 조회 —
 * 아키텍처 테스트 화이트리스트에 이유와 함께 등록돼 있다. isolate당 스트림마다 한 번만 센다.
 */
export async function tenantLineCount(db: D1Database, tenantId: string, stream: ActiveStream): Promise<number> {
  return cachedForStream(stream, `line_count:${tenantId}`, async () => {
    const r = await db.prepare(`SELECT COUNT(*) AS n FROM ${slotTable("earnings_line", stream.slot)} WHERE tenant_id = ?`).bind(tenantId).first<{ n: number }>();
    return r?.n ?? 0;
  });
}

const perStream = new Map<string, unknown>();

/** isolate 단위 캐시: 같은 스트림이면 한 번만 계산한다. 키에 stream_hash가 들어가므로 전환되면 새로 계산된다. */
export async function cachedForStream<T>(stream: ActiveStream, key: string, load: () => Promise<T>): Promise<T> {
  const k = `${stream.streamHash}:${key}`;
  if (perStream.has(k)) return perStream.get(k) as T;
  const value = await load();
  perStream.set(k, value);
  return value;
}
