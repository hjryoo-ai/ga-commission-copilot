// D1 접근의 유일한 통로(CLAUDE.md 규약 3, 설계서 v0.1.12 §5.1·§7, PHASES Phase 2 항목 2).
// - ScopedQuery: 생성자에서 tenant_id·agent_id·활성 스트림(슬롯)을 받고, 모든 SQL에 `tenant_id = ? AND agent_id = ?`를 붙여 바인딩한다.
//   agent_id 열이 없는 표(policy_limit_history)는 소유 원장 부분 질의로 같은 두 조건을 건다(설계서 v0.1.12 §7).
// - 읽기 모델 8표는 A/B 슬롯 두 벌이다. 슬롯 표 이름은 이 파일의 slotTable()만 만든다 — 다른 코드에는 슬롯 접미 리터럴이 없다(아키텍처 테스트).
// - 활성 슬롯은 stream_meta(전역 표, 테넌트 열 없음)의 active=1 한 행. 요청마다 읽는다 — 슬롯을 캐시하면 전환 뒤에도 옛 슬롯을 읽는다.
//   isolate 캐시는 stream_hash를 키로 한 파생 값만(cachedForStream).
// 식별자(표·열·정렬)는 허용 목록·패턴으로 막고, 값은 전부 바인딩한다. 금액 계산은 하지 않는다(규약 2 — DerivedNumbers).

/** 데모 테넌트(gen/world/rules/tables.ts TENANT와 같은 값 — worker는 gen을 import하지 않는다). */
export const DEMO_TENANT = "T1";

export type Slot = "a" | "b";

export interface ActiveStream {
  streamHash: string;
  slot: Slot;
}

/** stream_meta 활성 행(설계서 v0.1.11 — line_count는 적재기 ⑤ 재검사 값). */
export interface StreamMeta extends ActiveStream {
  generatedAt: string;
  lineCount: number | null;
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

/** agent_id 열이 없는 표 → 소유 표와 잇는 키. */
const OWNED_VIA: Partial<Record<ReadModelTable, { key: string; owner: ReadModelTable }>> = {
  policy_limit_history: { key: "ledger_id", owner: "policy_limit" },
};

const IDENT = /^[a-z][a-z0-9_]*$/;
type Scalar = string | number;
type Value = Scalar | null;
type Op = "=" | "<" | "<=" | ">" | ">=";

/** 조건: 값(=), [비교 연산자, 값], ["IN", 값 목록], ["BETWEEN", 하한, 상한], ["IS NULL"] / ["IS NOT NULL"]. */
export type Cond =
  | Value
  | readonly [Op, Value]
  | readonly ["IN", readonly Scalar[]]
  | readonly ["BETWEEN", Scalar, Scalar]
  | readonly ["IS NULL"]
  | readonly ["IS NOT NULL"];

export interface WhereOptions {
  /** 열 → 조건. tenant_id·agent_id는 넣지 않는다(생성자 값이 붙는다). */
  where?: Readonly<Record<string, Cond>>;
}

export interface SelectOptions extends WhereOptions {
  columns: readonly string[];
  distinct?: boolean;
  /** "열" 또는 "열 DESC"를 쉼표로. */
  orderBy?: string;
  limit?: number;
  offset?: number;
}

const COMPARE: readonly string[] = ["=", "<", "<=", ">", ">="];
/** IN 목록 상한 — D1 바인딩 변수 수 제한(100) 안에서 범위 조건 몫을 남긴다. */
const IN_MAX = 90;

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

function bound(n: number | undefined, name: string, min: number): string {
  if (n === undefined) return "";
  if (!Number.isSafeInteger(n) || n < min) throw new Error(`invalid ${name}`);
  return ` ${name.toUpperCase()} ${n}`;
}

/** 조건 하나 → SQL 조각과 바인딩 값. */
function condition(col: string, c: Cond, params: Value[]): string {
  const name = ident(col);
  if (!Array.isArray(c)) {
    params.push(c as Value);
    return `${name} = ?`;
  }
  const [op, ...rest] = c as readonly [string, ...unknown[]];
  if (COMPARE.includes(op) && rest.length === 1) {
    params.push(rest[0] as Value);
    return `${name} ${op} ?`;
  }
  if (op === "IN" && rest.length === 1 && Array.isArray(rest[0])) {
    const list = rest[0] as readonly Scalar[];
    if (list.length === 0 || list.length > IN_MAX) throw new Error(`IN 목록 크기 ${list.length}`);
    params.push(...list);
    return `${name} IN (${list.map(() => "?").join(", ")})`;
  }
  if (op === "BETWEEN" && rest.length === 2) {
    params.push(rest[0] as Scalar, rest[1] as Scalar);
    return `${name} BETWEEN ? AND ?`;
  }
  if ((op === "IS NULL" || op === "IS NOT NULL") && rest.length === 0) return `${name} ${op}`;
  throw new Error(`invalid operator ${op}`);
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

  /** FROM … WHERE tenant_id = ? AND agent_id = ? [AND …] — 범위 조건을 맨 앞에 둔다. */
  private from(table: ReadModelTable, opts: WhereOptions): { from: string; params: Value[] } {
    const params: Value[] = [];
    const owned = OWNED_VIA[table];
    const conds = owned
      ? [`tenant_id = ?`, `${owned.key} IN (SELECT ${owned.key} FROM ${slotTable(owned.owner, this.stream.slot)} WHERE tenant_id = ? AND agent_id = ?)`]
      : ["tenant_id = ?", "agent_id = ?"];
    params.push(...(owned ? [this.tenantId, this.tenantId, this.agentId] : [this.tenantId, this.agentId]));
    for (const [col, c] of Object.entries(opts.where ?? {})) {
      if (col === "tenant_id" || col === "agent_id") throw new Error("tenant_id·agent_id는 생성자 값만 쓴다");
      conds.push(condition(col, c, params));
    }
    return { from: `FROM ${slotTable(table, this.stream.slot)} WHERE ${conds.join(" AND ")}`, params };
  }

  /** SELECT [DISTINCT] … FROM <표>_<슬롯> WHERE tenant_id = ? AND agent_id = ? [AND …] [ORDER BY …] [LIMIT n [OFFSET m]] — 문장과 바인딩 값. */
  build(table: ReadModelTable, opts: SelectOptions): { sql: string; params: Value[] } {
    if (opts.columns.length === 0) throw new Error("columns 비어 있음");
    if (opts.offset !== undefined && opts.limit === undefined) throw new Error("offset은 limit과 함께");
    const { from, params } = this.from(table, opts);
    let sql = `SELECT ${opts.distinct ? "DISTINCT " : ""}${opts.columns.map(ident).join(", ")} ${from}`;
    if (opts.orderBy) sql += ` ORDER BY ${orderBy(opts.orderBy)}`;
    sql += bound(opts.limit, "limit", 1) + bound(opts.offset, "offset", 0);
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

  /** 행 수(라인 목록 total). 금액이 아니라 행을 센다. */
  async count(table: ReadModelTable, opts: WhereOptions = {}): Promise<number> {
    const { from, params } = this.from(table, opts);
    return (await this.db.prepare(`SELECT COUNT(*) AS n ${from}`).bind(...params).first<{ n: number }>())?.n ?? 0;
  }
}

// ─── 설계사 범위 밖의 접근(전역 표·데모 설정·연결 확인) — 설계사 행을 내주지 않는 것만 둔다 ─────────────────

/** 활성 스트림. 첫 적재 전이면 null. stream_meta는 테넌트 열이 없는 전역 표다. */
export async function activeStream(db: D1Database): Promise<StreamMeta | null> {
  const row = await db
    .prepare("SELECT stream_hash, slot, generated_at, line_count FROM stream_meta WHERE active = 1")
    .first<{ stream_hash: string; slot: Slot; generated_at: string; line_count: number | null }>();
  return row ? { streamHash: row.stream_hash, slot: row.slot, generatedAt: row.generated_at, lineCount: row.line_count } : null;
}

/** D1 연결 확인(SELECT 1). */
export async function ping(db: D1Database): Promise<number | null> {
  return (await db.prepare("SELECT 1 AS one").first<{ one: number }>())?.one ?? null;
}

export interface DemoAgentRow {
  demo_no: 1 | 2 | 3;
  agent_id: string;
  card_label: string;
  contract_count: number;
}

const DEMO_COLUMNS = "demo_no, agent_id, card_label, contract_count";

/** 활성 스트림의 데모 설계사 3명(설계서 v0.1.11 §5.1 demo_agents — 공개 카드·세션 발급의 출처). */
export async function demoAgents(db: D1Database, tenantId: string, stream: ActiveStream): Promise<DemoAgentRow[]> {
  const r = await db
    .prepare(`SELECT ${DEMO_COLUMNS} FROM demo_agents WHERE tenant_id = ? AND stream_hash = ? ORDER BY demo_no`)
    .bind(tenantId, stream.streamHash)
    .all<DemoAgentRow>();
  return r.results;
}

/** 데모 번호 하나(세션 발급·요청마다 쿠키 대조). */
export async function demoAgent(db: D1Database, tenantId: string, stream: ActiveStream, demoNo: number): Promise<DemoAgentRow | null> {
  return db
    .prepare(`SELECT ${DEMO_COLUMNS} FROM demo_agents WHERE tenant_id = ? AND stream_hash = ? AND demo_no = ?`)
    .bind(tenantId, stream.streamHash, demoNo)
    .first<DemoAgentRow>();
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
