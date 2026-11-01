// get_deferrals(from, to)(설계서 §4.3): 지급 예정월이 기간 안인 분급(이연) 항목 — 월별 합계·상태별 합계(DerivedNumbers) + 항목(최대 30건).
import { policyMasked } from "../api/policy";
import { DerivedNumbers } from "../domain/DerivedNumbers";
import { fitList, type ToolContext, type ToolData } from "./result";

interface DeferralRow {
  schedule_id: string;
  policy_no: string;
  due_ym: string;
  amount: number;
  status: string;
  reason: string;
}

export async function getDeferrals(ctx: ToolContext, from: string, to: string): Promise<{ data: ToolData; tokens: number; truncated: boolean }> {
  const rows = await ctx.q.all<DeferralRow>("deferral_item", {
    columns: ["schedule_id", "policy_no", "due_ym", "amount", "status", "reason"],
    where: { due_ym: ["BETWEEN", from, to] },
    orderBy: "due_ym, schedule_id",
  });
  const head = {
    from,
    to,
    itemCount: rows.length,
    byMonth: DerivedNumbers.sumBy(rows.map((r) => ({ key: r.due_ym, amount: r.amount }))),
    byStatus: DerivedNumbers.sumBy(rows.map((r) => ({ key: r.status, amount: r.amount }))),
  };
  return fitList(
    (xs) => ({ ...head, items: xs.map((r) => ({ scheduleId: r.schedule_id, policyMasked: policyMasked(r.policy_no), dueYm: r.due_ym, amount: r.amount, status: r.status, reason: r.reason })) }),
    "items",
    rows,
  );
}
