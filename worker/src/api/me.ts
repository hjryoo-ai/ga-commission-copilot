// 읽기 API(설계서 v0.1.12 §7, 상위 §7 구조 — 계약 contracts/api/v1/portal-api.openapi.yaml + copilot-overlay.json, PHASES Phase 2 항목 3).
// 모든 조회는 세션 범위의 ScopedQuery로만 한다(규약 3). 금액은 읽은 값 그대로 — 합계·잔여·소진율·단계는 DerivedNumbers(규약 2).
// explanation은 Phase 3까지 null.
import { Hono } from "hono";
import { DEMO_TENANT, type ScopedQuery } from "../db/ScopedQuery";
import { DerivedNumbers, type LimitStage } from "../domain/DerivedNumbers";
import { type AppEnv, compact, invalidRequest, notFound, ok, YM } from "./http";
import { policyKeys, policyMasked } from "./policy";
import { requireSession } from "./session";

/** 데모 테넌트 표시 값(설계서 v0.1.12 §7 — 상위 §5 tenant 예시값, 테넌트 표가 없어 상수). */
export const DEMO_TENANT_CONFIG = { name: "데모GA", payoutDayRule: "NEXT_MONTH_D10", limitWarnBp: 8000, limitCritBp: 9500 } as const;

const RANGE_MAX = 36;
const PAGE_MAX = 1_000_000;
const SIZE_DEFAULT = 50;
const SIZE_MAX = 200;
/** IN 목록 한 번에(ScopedQuery IN_MAX 안). */
const CHUNK = 80;
const COMM_TYPE = /^[A-Z][A-Z0-9_]{0,31}$/;
const POLICY_KEY = /^[0-9a-f]{16}$/;
const KEY_MAX = 128;
const FLAG_ORDER = ["CANCELLED", "LAPSED", "OVERDUE", "REDUCED"] as const;

interface MonthRow {
  close_ym: string;
  gross: number;
  clawback_offset: number;
  adjustment: number;
  withholding_tax: number | null;
  net: number | null;
  status: string;
  data_status: string;
  estimate_as_of: string | null;
  estimate_basis_seq: number | null;
  confirmed_at: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  receivable_offset: number | null;
  carried_receivable: number | null;
  payable: number | null;
  run_seq: number | null;
  net_basis: string | null;
}

const MONTH_COLUMNS = [
  "close_ym",
  "gross",
  "clawback_offset",
  "adjustment",
  "withholding_tax",
  "net",
  "status",
  "data_status",
  "estimate_as_of",
  "estimate_basis_seq",
  "confirmed_at",
  "paid_at",
  "paid_amount",
  "receivable_offset",
  "carried_receivable",
  "payable",
  "run_seq",
  "net_basis",
] as const;

interface LineRow {
  calc_id: string;
  close_ym: string;
  comm_type: string;
  amount: number;
  limit_cut_amt: number;
  limit_cut_policy: string | null;
  product_key: string | null;
  policy_no: string;
  reversal_of_calc_id: string | null;
}

const LINE_COLUMNS = ["calc_id", "close_ym", "comm_type", "amount", "limit_cut_amt", "limit_cut_policy", "product_key", "policy_no", "reversal_of_calc_id"] as const;

interface LedgerRow {
  ledger_id: string;
  policy_no: string;
  contract_date: string;
  fy_start: string;
  fy_end: string;
  monthly_premium: number;
  limit_multiple: string;
  limit_amount: number;
  accum_paid: number;
  cut_total: number;
  deferred_total: number;
  rule_version_id: string;
}

const LEDGER_COLUMNS = [
  "ledger_id",
  "policy_no",
  "contract_date",
  "fy_start",
  "fy_end",
  "monthly_premium",
  "limit_multiple",
  "limit_amount",
  "accum_paid",
  "cut_total",
  "deferred_total",
  "rule_version_id",
] as const;

type AmountRow = { close_ym: string; comm_type: string; amount: number };

function chunks<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

/** IN 목록이 길면 나눠 읽는다. */
async function allIn<T>(q: ScopedQuery, table: "earnings_line", col: string, values: readonly string[], columns: readonly string[]): Promise<T[]> {
  const parts = await Promise.all(chunks(values).map((v) => q.all<T>(table, { columns, where: { [col]: ["IN", v] } })));
  return parts.flat();
}

/** yyyyMM 달 순번(월 범위 폭 검사·전월 — 금액이 아니다). */
const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(4, 6)) - 1;
const ymOf = (index: number) => `${String(Math.floor(index / 12)).padStart(4, "0")}${String((index % 12) + 1).padStart(2, "0")}`;

/** 지급예정일(테넌트 규칙 NEXT_MONTH_D{n} — 상위 §14.1 #2: n이 다음 달에 없거나 형식이 다르면 생략). */
function payoutExpectedOn(closeYm: string): string | undefined {
  const m = DEMO_TENANT_CONFIG.payoutDayRule.match(/^NEXT_MONTH_D([1-9][0-9]?)$/);
  if (!m) return undefined;
  const next = ymOf(monthIndex(closeYm) + 1);
  const day = Number(m[1]);
  const y = Number(next.slice(0, 4));
  const mo = Number(next.slice(4, 6));
  if (day > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return undefined;
  return `${next.slice(0, 4)}-${next.slice(4, 6)}-${String(day).padStart(2, "0")}`;
}

function monthDataStatus(row: MonthRow, lines: readonly AmountRow[]): string {
  return DerivedNumbers.monthMatches(row, lines) ? row.data_status : "DRIFT";
}

function monthSummary(row: MonthRow, lines: readonly AmountRow[]) {
  return compact({
    closeYm: row.close_ym,
    status: row.status,
    monthDataStatus: monthDataStatus(row, lines),
    gross: row.gross,
    clawbackOffset: row.clawback_offset,
    adjustment: row.adjustment,
    withholdingTax: row.withholding_tax,
    net: row.net,
    netBasis: row.net_basis,
    paidAmount: row.paid_amount,
    paidAt: row.paid_at,
  });
}

/** 라인 행 → 계약 Line(증권번호 원문 없음). 짝 정보는 같은 요청에서 읽은 것만. */
function toLine(r: LineRow, keys: Map<string, string>, pair: { reversalOfYm?: string; reversedBy?: { calc_id: string; close_ym: string } }) {
  return compact({
    calcId: r.calc_id,
    closeYm: r.close_ym,
    commType: r.comm_type,
    amount: r.amount,
    limitCutAmt: r.limit_cut_amt,
    limitCutPolicy: r.limit_cut_policy,
    productKey: r.product_key,
    policyMasked: policyMasked(r.policy_no),
    policyKey: keys.get(r.policy_no)!,
    reversalOf: r.reversal_of_calc_id,
    reversedBy: pair.reversedBy?.calc_id,
    reversalOfYm: pair.reversalOfYm,
    reversedByYm: pair.reversedBy?.close_ym,
  });
}

/** 라인들의 취소 짝(상대 calcId·달) — 그 설계사 범위 안에서만 찾는다. */
async function pairs(q: ScopedQuery, rows: readonly LineRow[]) {
  const ids = rows.map((r) => r.calc_id);
  const ofIds = [...new Set(rows.map((r) => r.reversal_of_calc_id).filter((x): x is string => x !== null))];
  const [by, of] = await Promise.all([
    ids.length ? allIn<{ calc_id: string; close_ym: string; reversal_of_calc_id: string }>(q, "earnings_line", "reversal_of_calc_id", ids, ["calc_id", "close_ym", "reversal_of_calc_id"]) : [],
    ofIds.length ? allIn<{ calc_id: string; close_ym: string }>(q, "earnings_line", "calc_id", ofIds, ["calc_id", "close_ym"]) : [],
  ]);
  const reversedBy = new Map(by.map((x) => [x.reversal_of_calc_id, x]));
  const ofYm = new Map(of.map((x) => [x.calc_id, x.close_ym]));
  return (r: LineRow) => ({ reversedBy: reversedBy.get(r.calc_id), reversalOfYm: r.reversal_of_calc_id ? ofYm.get(r.reversal_of_calc_id) : undefined });
}

/** 원장 행 → 계약 Ledger(잔여·소진율·단계는 DerivedNumbers). */
function toLedger(r: LedgerRow, keys: Map<string, string>, flags: readonly string[], productKey: string | undefined) {
  return compact({
    ledgerId: r.ledger_id,
    policyMasked: policyMasked(r.policy_no),
    policyKey: keys.get(r.policy_no)!,
    contractDate: r.contract_date,
    fyStart: r.fy_start,
    fyEnd: r.fy_end,
    monthlyPremium: r.monthly_premium,
    limitMultiple: r.limit_multiple,
    limitAmount: r.limit_amount,
    accumPaid: r.accum_paid,
    remaining: DerivedNumbers.remaining(r.limit_amount, r.accum_paid),
    utilization: DerivedNumbers.utilization(r.accum_paid, r.limit_amount),
    stage: DerivedNumbers.stage(r.accum_paid, r.limit_amount, DEMO_TENANT_CONFIG.limitWarnBp, DEMO_TENANT_CONFIG.limitCritBp),
    cutTotal: r.cut_total,
    deferredTotal: r.deferred_total,
    flags: FLAG_ORDER.filter((f) => flags.includes(f)),
    ruleVersionId: r.rule_version_id,
    productKey,
  });
}

/** 원장 카드에 붙는 열린 플래그·상품 키(그 계약의 첫 라인). */
async function ledgerExtras(q: ScopedQuery) {
  const [flags, firstLines] = await Promise.all([
    q.all<{ policy_no: string; flag_type: string }>("policy_flag", { columns: ["policy_no", "flag_type"], where: { cleared_at: ["IS NULL"] } }),
    q.all<{ policy_no: string; product_key: string }>("earnings_line", { columns: ["policy_no", "product_key"], where: { product_key: ["IS NOT NULL"] }, orderBy: "source_seq, calc_id" }),
  ]);
  const product = new Map<string, string>();
  for (const l of firstLines) if (!product.has(l.policy_no)) product.set(l.policy_no, l.product_key);
  return { flagsOf: (p: string) => flags.filter((f) => f.policy_no === p).map((f) => f.flag_type), productOf: (p: string) => product.get(p) };
}

function intParam(v: string | undefined, def: number, min: number, max: number): number | null {
  if (v === undefined) return def;
  if (!/^(0|[1-9][0-9]{0,6})$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

const parseJson = (s: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export const me = new Hono<AppEnv>();
me.use("*", requireSession);

me.get("/", async (c) => {
  const { q, agentId } = c.get("scope");
  const [p, first, last] = await Promise.all([
    q.first<{ name: string; grade: string | null; org_path: string; status: string }>("agent_profile", { columns: ["name", "grade", "org_path", "status"] }),
    q.first<{ close_ym: string }>("earnings_month", { columns: ["close_ym"], orderBy: "close_ym" }),
    q.first<{ close_ym: string }>("earnings_month", { columns: ["close_ym"], orderBy: "close_ym DESC" }),
  ]);
  return ok(
    c,
    compact({
      agentId,
      role: "AGENT",
      agentName: p?.name,
      grade: p?.grade,
      orgPath: p?.org_path,
      status: p?.status,
      tenant: DEMO_TENANT_CONFIG,
      months: first && last ? { from: first.close_ym, to: last.close_ym } : undefined,
    }),
  );
});

me.get("/earnings", async (c) => {
  const { q } = c.get("scope");
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (!from || !to || !YM.test(from) || !YM.test(to) || from > to || monthIndex(to) - monthIndex(from) + 1 > RANGE_MAX) return invalidRequest(c);
  const [rows, lines] = await Promise.all([
    q.all<MonthRow>("earnings_month", { columns: MONTH_COLUMNS, where: { close_ym: ["BETWEEN", from, to] }, orderBy: "close_ym" }),
    q.all<AmountRow>("earnings_line", { columns: ["close_ym", "comm_type", "amount"], where: { close_ym: ["BETWEEN", from, to] } }),
  ]);
  return ok(c, { from, to, items: rows.map((r) => monthSummary(r, lines.filter((l) => l.close_ym === r.close_ym))) });
});

me.get("/earnings/lines/:calcId", async (c) => {
  const { q } = c.get("scope");
  const calcId = c.req.param("calcId");
  if (calcId.length > KEY_MAX) return notFound(c);
  const r = await q.first<LineRow & { basis: string; policy_summary: string }>("earnings_line", { columns: [...LINE_COLUMNS, "basis", "policy_summary"], where: { calc_id: calcId } });
  if (!r) return notFound(c);
  const [pairOf, keys, deferrals, receivable, ledger] = await Promise.all([
    pairs(q, [r]),
    policyKeys(c.env.POLICY_KEY_SECRET ?? "", DEMO_TENANT, [r.policy_no]),
    q.all<{ schedule_id: string; due_ym: string; amount: number; status: string }>("deferral_item", {
      columns: ["schedule_id", "due_ym", "amount", "status"],
      where: { source_calc_id: calcId },
      orderBy: "due_ym, schedule_id",
    }),
    q.first<{ receivable_id: string; amount: number; remaining: number; status: string }>("clawback_item", { columns: ["receivable_id", "amount", "remaining", "status"], where: { origin_calc_id: calcId } }),
    q.first<{ ledger_id: string }>("policy_limit", { columns: ["ledger_id"], where: { policy_no: r.policy_no } }),
  ]);
  const basis = parseJson(r.basis);
  const summary = parseJson(r.policy_summary);
  return ok(c, {
    ...compact({
      line: toLine(r, keys, pairOf(r)),
      basis: compact({
        rate: typeof basis.rate === "string" ? basis.rate : undefined,
        payoutRate: typeof basis.payoutRate === "string" ? basis.payoutRate : undefined,
        installmentNo: typeof basis.installmentNo === "number" ? basis.installmentNo : undefined,
        ruleVersionIds: Array.isArray(basis.ruleVersionIds) ? basis.ruleVersionIds.filter((x): x is string => typeof x === "string" && x !== "") : [],
      }),
      policySummary: compact({
        contractDate: typeof summary.contractDate === "string" ? summary.contractDate : undefined,
        monthlyPremium: typeof summary.monthlyPremium === "number" ? summary.monthlyPremium : undefined,
      }),
      deferrals: deferrals.map((d) => ({ scheduleId: d.schedule_id, dueYm: d.due_ym, amount: d.amount, status: d.status })),
      receivable: receivable ? { receivableId: receivable.receivable_id, amount: receivable.amount, remaining: receivable.remaining, status: receivable.status } : undefined,
      ledgerId: ledger?.ledger_id,
    }),
    explanation: null,
  });
});

me.get("/earnings/:ym", async (c) => {
  const { q } = c.get("scope");
  const ym = c.req.param("ym");
  if (!YM.test(ym)) return notFound(c);
  const prevYm = ymOf(monthIndex(ym) - 1);
  const [row, lines, prev] = await Promise.all([
    q.first<MonthRow>("earnings_month", { columns: MONTH_COLUMNS, where: { close_ym: ym } }),
    q.all<AmountRow>("earnings_line", { columns: ["close_ym", "comm_type", "amount"], where: { close_ym: ym } }),
    q.first<{ close_ym: string; status: string; gross: number; net: number | null; net_basis: string | null }>("earnings_month", {
      columns: ["close_ym", "status", "gross", "net", "net_basis"],
      where: { close_ym: prevYm },
    }),
  ]);
  if (!row) return notFound(c);
  return ok(
    c,
    compact({
      ...monthSummary(row, lines),
      byType: DerivedNumbers.byType(lines),
      estimateAsOf: row.estimate_as_of,
      estimateBasisSeq: row.estimate_basis_seq,
      confirmedAt: row.confirmed_at,
      receivableOffset: row.receivable_offset,
      carriedReceivable: row.carried_receivable,
      payable: row.payable,
      runSeq: row.run_seq,
      payoutExpectedOn: payoutExpectedOn(ym),
      previous: prev ? compact({ closeYm: prev.close_ym, status: prev.status, gross: prev.gross, net: prev.net, netBasis: prev.net_basis }) : undefined,
    }),
  );
});

me.get("/earnings/:ym/lines", async (c) => {
  const { q } = c.get("scope");
  const ym = c.req.param("ym");
  if (!YM.test(ym)) return notFound(c);
  const page = intParam(c.req.query("page"), 0, 0, PAGE_MAX);
  const size = intParam(c.req.query("size"), SIZE_DEFAULT, 1, SIZE_MAX);
  const commType = c.req.query("commType");
  const key = c.req.query("policyKey");
  if (page === null || size === null || (commType !== undefined && !COMM_TYPE.test(commType)) || (key !== undefined && !POLICY_KEY.test(key))) return invalidRequest(c);
  if (!(await q.first("earnings_month", { columns: ["close_ym"], where: { close_ym: ym } }))) return notFound(c);

  const secret = c.env.POLICY_KEY_SECRET ?? "";
  const where: Record<string, string> = { close_ym: ym };
  if (commType) where.comm_type = commType;
  if (key) {
    // 키 → 원문은 그 설계사의 증권번호 집합으로만(SQL에 키 없음 — 남의 키는 빈 결과)
    const own = await q.all<{ policy_no: string }>("earnings_line", { columns: ["policy_no"], distinct: true });
    const keys = await policyKeys(secret, DEMO_TENANT, own.map((x) => x.policy_no));
    const match = [...keys].find(([, k]) => k === key)?.[0];
    if (!match) return ok(c, { closeYm: ym, page, size, total: 0, items: [] });
    where.policy_no = match;
  }
  const [total, rows] = await Promise.all([
    q.count("earnings_line", { where }),
    q.all<LineRow>("earnings_line", { columns: LINE_COLUMNS, where, orderBy: "source_seq, calc_id", limit: size, offset: page * size }),
  ]);
  const [pairOf, keys] = await Promise.all([pairs(q, rows), policyKeys(secret, DEMO_TENANT, rows.map((r) => r.policy_no))]);
  return ok(c, { closeYm: ym, page, size, total, items: rows.map((r) => toLine(r, keys, pairOf(r))) });
});

me.get("/limits", async (c) => {
  const { q } = c.get("scope");
  const status = c.req.query("status") ?? "ALL";
  if (!["ALL", "WARN", "CRIT", "FULL"].includes(status)) return invalidRequest(c);
  const [rows, extras] = await Promise.all([q.all<LedgerRow>("policy_limit", { columns: LEDGER_COLUMNS, orderBy: "ledger_id" }), ledgerExtras(q)]);
  const keys = await policyKeys(c.env.POLICY_KEY_SECRET ?? "", DEMO_TENANT, rows.map((r) => r.policy_no));
  const items = rows.map((r) => toLedger(r, keys, extras.flagsOf(r.policy_no), extras.productOf(r.policy_no)));
  return ok(c, { status, items: status === "ALL" ? items : items.filter((x) => x.stage === (status as LimitStage)) });
});

me.get("/limits/:ledgerId", async (c) => {
  const { q } = c.get("scope");
  const ledgerId = c.req.param("ledgerId");
  if (ledgerId.length > KEY_MAX) return notFound(c);
  const r = await q.first<LedgerRow>("policy_limit", { columns: LEDGER_COLUMNS, where: { ledger_id: ledgerId } });
  if (!r) return notFound(c);
  const [extras, keys, history] = await Promise.all([
    ledgerExtras(q),
    policyKeys(c.env.POLICY_KEY_SECRET ?? "", DEMO_TENANT, [r.policy_no]),
    q.all<{
      source_seq: number;
      kind: string;
      posting_seq: number | null;
      calc_id: string | null;
      amount: number | null;
      accum_after: number | null;
      limit_after: number | null;
      reason: string | null;
      occurred_at: string | null;
    }>("policy_limit_history", {
      columns: ["source_seq", "kind", "posting_seq", "calc_id", "amount", "accum_after", "limit_after", "reason", "occurred_at"],
      where: { ledger_id: ledgerId },
      orderBy: "source_seq",
    }),
  ]);
  return ok(c, {
    ledger: toLedger(r, keys, extras.flagsOf(r.policy_no), extras.productOf(r.policy_no)),
    history: history.map((h) =>
      compact({
        sourceSeq: h.source_seq,
        kind: h.kind,
        postingSeq: h.posting_seq,
        calcId: h.calc_id,
        amount: h.amount,
        accumAfter: h.accum_after,
        limitAfter: h.limit_after,
        reason: h.reason,
        occurredAt: h.occurred_at,
      }),
    ),
    explanation: null,
  });
});
