// 설명 컨텍스트 빌더 3종(설계서 v0.1.14 §4.1(b), PHASES Phase 3 항목 2). 입력은 읽기 모델 행(projection-java 뷰 = D1 슬롯 표와 같은 열).
// - 증권번호는 마스킹 값만(응답 값에 POL-… 없음 — v0.1.13). 설계사 ID·생성 ID는 넣지 않는다(G6·제외 패턴).
// - 파생값(요청액·잔여·소진율·단계·전월 차이)은 packages/grounding DerivedNumbers만 계산한다(규약 2).
// - 같은 함수가 적재 후 전수 재검증(verify-explanations.ts)에서도 쓰인다 — D1 행으로 만든 컨텍스트가 생성 때와 같아야 한다.
import { DerivedNumbers, type Json } from "@copilot/grounding";

export type Row = Record<string, unknown>;
export type Kind = "LINE" | "LIMIT" | "MONTH_DIFF";

/** 한 설계사의 읽기 모델 행(표 이름 → 행). */
export interface AgentRows {
  agentId: string;
  earnings_line: Row[];
  earnings_month: Row[];
  policy_limit: Row[];
  policy_limit_history: Row[];
  deferral_item: Row[];
  clawback_item: Row[];
}

/** 데모 테넌트 경고 단계(설계서 v0.1.12 §7 — worker DEMO_TENANT_CONFIG와 같은 값). */
const WARN_BP = 8000;
const CRIT_BP = 9500;
/** 월비교 컨텍스트에 넣는 그 달 라인 상한(토큰 — Groq TPM 8K, 설계서 §10.2). */
const MONTH_LINES_MAX = 20;

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isSafeInteger(v) ? v : undefined);
const obj = (v: unknown): Row => {
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as Row;
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" ? (v as Row) : {};
};

/** undefined 값을 뺀 객체(컨텍스트 키 = 실제 값이 있는 것만 — G5). */
function clean<T extends Record<string, unknown>>(o: T): Json {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Json;
}

/** 증권번호 마스킹(끝 4자 외 '*' — worker/src/api/policy.ts policyMasked와 같은 규칙. gen은 worker를 import하지 않는다). */
export function policyMasked(policyNo: string): string {
  const keep = policyNo.length > 4 ? policyNo.slice(-4) : "";
  return "*".repeat(policyNo.length - keep.length) + keep;
}

const bySeq = (a: Row, b: Row) => (int(a.source_seq) ?? 0) - (int(b.source_seq) ?? 0) || String(a.calc_id).localeCompare(String(b.calc_id));
const date = (v: unknown) => str(v)?.slice(0, 10);

function prevYm(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(4, 6));
  return m === 1 ? `${y - 1}12` : `${y}${String(m - 1).padStart(2, "0")}`;
}

function deferral(d: Row): Json {
  return clean({ dueYm: str(d.due_ym), amount: int(d.amount), status: str(d.status), reason: str(d.reason) });
}

/** LINE: {line, basis, policySummary, ledger?, limitPosting?, deferrals[], receivable?, derived}. */
export function lineContext(rows: AgentRows, calcId: string): Json | null {
  const l = rows.earnings_line.find((x) => x.calc_id === calcId);
  if (!l) return null;
  const policyNo = String(l.policy_no);
  const basis = obj(l.basis);
  const summary = obj(l.policy_summary);
  const ledger = rows.policy_limit.find((x) => x.policy_no === policyNo);
  const posting = rows.policy_limit_history.find((h) => h.calc_id === calcId && h.kind === "POST");
  const reversed = str(l.reversal_of_calc_id) ? rows.earnings_line.find((x) => x.calc_id === l.reversal_of_calc_id) : undefined;
  const receivable = rows.clawback_item.find((r) => r.origin_calc_id === calcId);
  const cut = int(l.limit_cut_amt) ?? 0;
  const amount = int(l.amount)!;
  return clean({
    line: clean({
      closeYm: str(l.close_ym),
      commType: str(l.comm_type),
      amount,
      limitCutAmt: cut > 0 ? cut : undefined,
      limitCutPolicy: str(l.limit_cut_policy),
      productKey: str(l.product_key),
      policyMasked: policyMasked(policyNo),
      reversalOfYm: reversed ? str(reversed.close_ym) : undefined,
      reversalOfCommType: reversed ? str(reversed.comm_type) : undefined,
    }),
    basis: clean({ rate: str(basis.rate), payoutRate: str(basis.payoutRate), installmentNo: int(basis.installmentNo) }),
    policySummary: clean({ contractDate: str(summary.contractDate), monthlyPremium: int(summary.monthlyPremium) }),
    ledger: ledger ? clean({ limitAmount: int(ledger.limit_amount), limitMultiple: str(ledger.limit_multiple), fyStart: str(ledger.fy_start), fyEnd: str(ledger.fy_end) }) : undefined,
    limitPosting: posting
      ? clean({
          accumAfter: int(posting.accum_after),
          limitAfter: int(posting.limit_after),
          utilizationAfter: DerivedNumbers.utilization(int(posting.accum_after)!, int(posting.limit_after)!),
          postedOn: date(posting.occurred_at),
        })
      : undefined,
    deferrals: rows.deferral_item
      .filter((d) => d.source_calc_id === calcId)
      .sort((a, b) => String(a.due_ym).localeCompare(String(b.due_ym)))
      .map(deferral),
    receivable: receivable ? clean({ amount: int(receivable.amount), remaining: int(receivable.remaining), status: str(receivable.status) }) : undefined,
    derived: cut > 0 ? { requested: DerivedNumbers.requested(amount, cut) } : undefined,
  });
}

/** LIMIT: {ledger, derived, history[], deferrals[]}. */
export function limitContext(rows: AgentRows, ledgerId: string): Json | null {
  const r = rows.policy_limit.find((x) => x.ledger_id === ledgerId);
  if (!r) return null;
  const policyNo = String(r.policy_no);
  const limit = int(r.limit_amount)!;
  const accum = int(r.accum_paid)!;
  const lineOf = new Map(rows.earnings_line.map((l) => [l.calc_id, l]));
  return clean({
    ledger: clean({
      policyMasked: policyMasked(policyNo),
      contractDate: str(r.contract_date),
      fyStart: str(r.fy_start),
      fyEnd: str(r.fy_end),
      monthlyPremium: int(r.monthly_premium),
      limitMultiple: str(r.limit_multiple),
      limitAmount: limit,
      accumPaid: accum,
      cutTotal: int(r.cut_total),
      deferredTotal: int(r.deferred_total),
    }),
    derived: clean({
      remaining: DerivedNumbers.remaining(limit, accum),
      utilization: DerivedNumbers.utilization(accum, limit),
      stage: DerivedNumbers.stage(accum, limit, WARN_BP, CRIT_BP),
    }),
    history: rows.policy_limit_history
      .filter((h) => h.ledger_id === ledgerId)
      .sort(bySeq)
      .map((h) => {
        const line = lineOf.get(h.calc_id);
        const after = int(h.accum_after);
        const limitAfter = int(h.limit_after);
        return clean({
          kind: str(h.kind),
          on: date(h.occurred_at),
          commType: line ? str(line.comm_type) : undefined,
          closeYm: line ? str(line.close_ym) : undefined,
          amount: int(h.amount),
          limitCutAmt: line && (int(line.limit_cut_amt) ?? 0) > 0 ? int(line.limit_cut_amt) : undefined,
          limitCutPolicy: line ? str(line.limit_cut_policy) : undefined,
          accumAfter: after,
          limitAfter,
          utilizationAfter: after !== undefined && limitAfter !== undefined ? DerivedNumbers.utilization(after, limitAfter) : undefined,
          reason: str(h.reason),
        });
      }),
    deferrals: rows.deferral_item
      .filter((d) => d.policy_no === policyNo)
      .sort((a, b) => String(a.due_ym).localeCompare(String(b.due_ym)) || String(a.schedule_id).localeCompare(String(b.schedule_id)))
      .map(deferral),
  });
}

interface MonthLike {
  close_ym?: unknown;
  gross?: unknown;
  clawback_offset?: unknown;
  adjustment?: unknown;
  withholding_tax?: unknown;
  net?: unknown;
}

function monthFacts(m: MonthLike, lineCount: number): Json {
  return clean({
    closeYm: str(m.close_ym),
    gross: int(m.gross),
    clawbackOffset: int(m.clawback_offset),
    adjustment: int(m.adjustment),
    withholdingTax: int(m.withholding_tax),
    net: int(m.net),
    lineCount,
  });
}

/** MONTH_DIFF: {month, previous|null, byType[], lines[], derived}. 전월 행이 없으면 previous: null("전월 명세 없음"). */
export function monthDiffContext(rows: AgentRows, ym: string): Json | null {
  const cur = rows.earnings_month.find((m) => m.close_ym === ym);
  if (!cur) return null;
  const pym = prevYm(ym);
  const prev = rows.earnings_month.find((m) => m.close_ym === pym);
  const curLines = rows.earnings_line.filter((l) => l.close_ym === ym).sort(bySeq);
  const prevLines = rows.earnings_line.filter((l) => l.close_ym === pym);
  const amounts = (ls: Row[]) => ls.map((l) => ({ comm_type: String(l.comm_type), amount: int(l.amount)! }));
  const curBy = DerivedNumbers.byType(amounts(curLines));
  const prevBy = DerivedNumbers.byType(amounts(prevLines));
  const types = [...new Set([...Object.keys(curBy), ...(prev ? Object.keys(prevBy) : [])])].sort();
  const gross = int(cur.gross)!;
  return clean({
    month: monthFacts(cur, curLines.length),
    previous: prev ? monthFacts(prev, prevLines.length) : { closeYm: pym, statement: "NONE" },
    byType: types.map((t) =>
      clean({
        commType: t,
        amount: curBy[t],
        previousAmount: prev ? prevBy[t] : undefined,
        delta: prev ? DerivedNumbers.delta(curBy[t] ?? 0, prevBy[t] ?? 0) : undefined,
      }),
    ),
    lines: curLines.slice(0, MONTH_LINES_MAX).map((l) => clean({ commType: str(l.comm_type), amount: int(l.amount), policyMasked: policyMasked(String(l.policy_no)) })),
    linesOmitted: curLines.length > MONTH_LINES_MAX ? curLines.length - MONTH_LINES_MAX : undefined,
    derived: prev
      ? clean({
          grossDelta: DerivedNumbers.delta(gross, int(prev.gross)!),
          clawbackOffsetDelta: DerivedNumbers.delta(int(cur.clawback_offset) ?? 0, int(prev.clawback_offset) ?? 0),
          netDelta: int(cur.net) !== undefined && int(prev.net) !== undefined ? DerivedNumbers.delta(int(cur.net)!, int(prev.net)!) : undefined,
        })
      : undefined,
  });
}

export function contextOf(rows: AgentRows, kind: Kind, subjectId: string): Json | null {
  if (kind === "LINE") return lineContext(rows, subjectId);
  if (kind === "LIMIT") return limitContext(rows, subjectId);
  return monthDiffContext(rows, subjectId);
}

/** 설명 대상(설계서 v0.1.14 §4.1(b)): LINE 전부 → LIMIT 전부 → MONTH_DIFF(첫 달 제외). 순서는 결정론. */
export function subjectsOf(rows: AgentRows): { kind: Kind; subjectId: string }[] {
  const months = [...new Set(rows.earnings_month.map((m) => String(m.close_ym)))].sort();
  return [
    ...[...rows.earnings_line].sort(bySeq).map((l) => ({ kind: "LINE" as const, subjectId: String(l.calc_id) })),
    ...rows.policy_limit.map((l) => String(l.ledger_id)).sort().map((id) => ({ kind: "LIMIT" as const, subjectId: id })),
    ...months.slice(1).map((ym) => ({ kind: "MONTH_DIFF" as const, subjectId: ym })),
  ];
}
