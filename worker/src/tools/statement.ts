// get_statement(ym)(설계서 §4.3): earnings_month + 유형별 합계 + 라인 요약(최대 30건). 금액은 읽은 값 그대로, 합계·요청액은 DerivedNumbers.
import { policyMasked } from "../api/policy";
import { compact } from "../api/http";
import { DerivedNumbers } from "../domain/DerivedNumbers";
import { fitList, type ToolContext, type ToolData } from "./result";

interface MonthRow {
  close_ym: string;
  status: string;
  gross: number;
  clawback_offset: number;
  adjustment: number;
  withholding_tax: number | null;
  net: number | null;
  paid_amount: number | null;
  paid_at: string | null;
  receivable_offset: number | null;
  carried_receivable: number | null;
}

interface LineRow {
  calc_id: string;
  close_ym: string;
  comm_type: string;
  amount: number;
  limit_cut_amt: number;
  limit_cut_policy: string | null;
  product_key: string | null;
  policy_no: string;
}

const MONTH_COLUMNS = ["close_ym", "status", "gross", "clawback_offset", "adjustment", "withholding_tax", "net", "paid_amount", "paid_at", "receivable_offset", "carried_receivable"] as const;
const LINE_COLUMNS = ["calc_id", "close_ym", "comm_type", "amount", "limit_cut_amt", "limit_cut_policy", "product_key", "policy_no"] as const;

function lineSummary(r: LineRow) {
  const cut = r.limit_cut_amt !== 0;
  return compact({
    calcId: r.calc_id,
    commType: r.comm_type,
    amount: r.amount,
    limitCutAmt: cut ? r.limit_cut_amt : undefined,
    limitCutPolicy: cut ? r.limit_cut_policy : undefined,
    requested: cut ? DerivedNumbers.requested(r.amount, r.limit_cut_amt) : undefined,
    productKey: r.product_key,
    policyMasked: policyMasked(r.policy_no),
  });
}

export async function getStatement(ctx: ToolContext, ym: string): Promise<{ data: ToolData; tokens: number; truncated: boolean }> {
  const [month, lines] = await Promise.all([
    ctx.q.first<MonthRow>("earnings_month", { columns: MONTH_COLUMNS, where: { close_ym: ym } }),
    ctx.q.all<LineRow>("earnings_line", { columns: LINE_COLUMNS, where: { close_ym: ym }, orderBy: "source_seq, calc_id" }),
  ]);
  if (!month) return fitList(() => ({ found: false, closeYm: ym }), "lines", []);
  const head = compact({
    found: true,
    closeYm: month.close_ym,
    status: month.status,
    gross: month.gross,
    clawbackOffset: month.clawback_offset,
    adjustment: month.adjustment,
    withholdingTax: month.withholding_tax,
    net: month.net,
    paidAmount: month.paid_amount,
    paidAt: month.paid_at,
    receivableOffset: month.receivable_offset,
    carriedReceivable: month.carried_receivable,
    byType: DerivedNumbers.byType(lines),
    lineCount: lines.length,
  });
  return fitList((xs) => ({ ...head, lines: xs.map(lineSummary) }), "lines", lines);
}
