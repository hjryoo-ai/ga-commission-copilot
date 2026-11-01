// get_limit(policyNo)(설계서 §4.3): 증권번호(뒷자리 마스킹 매칭 허용) → policy_limit + 이력 + 그 계약의 한도 삭감 라인 + 연결 분급(이연) 항목.
// 잔여·소진율·단계는 DerivedNumbers. 끝 4자리가 같은 계약이 여럿이면 후보만 돌려준다(어느 것인지 고르지 않는다).
import { policyMasked } from "../api/policy";
import { compact } from "../api/http";
import { DEMO_TENANT_CONFIG } from "../api/me";
import { DerivedNumbers } from "../domain/DerivedNumbers";
import { fitList, matchPolicies, type ToolContext, type ToolData } from "./result";

interface LedgerRow {
  ledger_id: string;
  policy_no: string;
  contract_date: string;
  monthly_premium: number;
  limit_multiple: string;
  limit_amount: number;
  accum_paid: number;
  cut_total: number;
  deferred_total: number;
}

interface HistoryRow {
  kind: string;
  calc_id: string | null;
  amount: number | null;
  accum_after: number | null;
  limit_after: number | null;
  reason: string | null;
  occurred_at: string | null;
}

interface CutRow {
  calc_id: string;
  close_ym: string;
  comm_type: string;
  amount: number;
  limit_cut_amt: number;
  limit_cut_policy: string | null;
}

interface DeferralRow {
  schedule_id: string;
  due_ym: string;
  amount: number;
  status: string;
  reason: string;
}

const LEDGER_COLUMNS = ["ledger_id", "policy_no", "contract_date", "monthly_premium", "limit_multiple", "limit_amount", "accum_paid", "cut_total", "deferred_total"] as const;

export async function getLimit(ctx: ToolContext, policyArg: string): Promise<{ data: ToolData; tokens: number; truncated: boolean }> {
  const ledgers = await ctx.q.all<LedgerRow>("policy_limit", { columns: LEDGER_COLUMNS, orderBy: "ledger_id" });
  const hits = matchPolicies(
    ledgers.map((l) => l.policy_no),
    policyArg,
  );
  if (hits.length !== 1) {
    const candidates = ledgers.filter((l) => hits.includes(l.policy_no)).map((l) => ({ ledgerId: l.ledger_id, policyMasked: policyMasked(l.policy_no), contractDate: l.contract_date }));
    return fitList((xs) => ({ found: false, ambiguous: hits.length > 1, candidates: xs }), "candidates", candidates);
  }
  const l = ledgers.find((x) => x.policy_no === hits[0])!;
  const [history, cuts, deferrals] = await Promise.all([
    ctx.q.all<HistoryRow>("policy_limit_history", { columns: ["kind", "calc_id", "amount", "accum_after", "limit_after", "reason", "occurred_at"], where: { ledger_id: l.ledger_id }, orderBy: "source_seq" }),
    ctx.q.all<CutRow>("earnings_line", { columns: ["calc_id", "close_ym", "comm_type", "amount", "limit_cut_amt", "limit_cut_policy"], where: { policy_no: l.policy_no, limit_cut_amt: [">", 0] }, orderBy: "source_seq, calc_id" }),
    ctx.q.all<DeferralRow>("deferral_item", { columns: ["schedule_id", "due_ym", "amount", "status", "reason"], where: { policy_no: l.policy_no }, orderBy: "due_ym, schedule_id" }),
  ]);
  const head = {
    found: true,
    ledger: compact({
      ledgerId: l.ledger_id,
      policyMasked: policyMasked(l.policy_no),
      contractDate: l.contract_date,
      monthlyPremium: l.monthly_premium,
      limitMultiple: l.limit_multiple,
      limitAmount: l.limit_amount,
      accumPaid: l.accum_paid,
      remaining: DerivedNumbers.remaining(l.limit_amount, l.accum_paid),
      utilization: DerivedNumbers.utilization(l.accum_paid, l.limit_amount),
      stage: DerivedNumbers.stage(l.accum_paid, l.limit_amount, DEMO_TENANT_CONFIG.limitWarnBp, DEMO_TENANT_CONFIG.limitCritBp),
      cutTotal: l.cut_total,
      deferredTotal: l.deferred_total,
    }),
    history: history.map((h) =>
      compact({
        kind: h.kind,
        calcId: h.calc_id,
        amount: h.amount,
        accumAfter: h.accum_after,
        limitAfter: h.limit_after,
        utilizationAfter: h.accum_after !== null && h.limit_after !== null ? DerivedNumbers.utilization(h.accum_after, h.limit_after) : undefined,
        reason: h.reason,
        occurredAt: h.occurred_at,
      }),
    ),
    limitCuts: cuts.map((c) =>
      compact({ calcId: c.calc_id, closeYm: c.close_ym, commType: c.comm_type, amount: c.amount, limitCutAmt: c.limit_cut_amt, limitCutPolicy: c.limit_cut_policy, requested: DerivedNumbers.requested(c.amount, c.limit_cut_amt) }),
    ),
  };
  return fitList((xs) => ({ ...head, deferrals: xs.map((d) => ({ scheduleId: d.schedule_id, dueYm: d.due_ym, amount: d.amount, status: d.status, reason: d.reason })) }), "deferrals", deferrals);
}
