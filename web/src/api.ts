// Worker 읽기 API 클라이언트(설계서 v0.1.12 §7 — 상위 계약 + 덧씌우기). 화면은 금액을 계산·비교·변환하지 않는다 — 받은 정수를 그대로 그린다.

export type Won = number;
export type MonthStatus = "PROVISIONAL" | "ESTIMATED" | "CONFIRMED" | "PAID";
export type NetBasis = "ESTIMATE" | "CONFIRM" | "PAYOUT";

export interface AsOf {
  streamHash: string;
  generatedAt: string;
  demoNo: 1 | 2 | 3;
}

interface Common {
  asOf: AsOf;
  dataStatus: "OK" | "DEGRADED";
  disclaimer: string;
}

export interface DemoAgentCard {
  demoNo: 1 | 2 | 3;
  cardLabel: string;
  contractCount: number;
  agentName?: string;
  grade?: string;
  orgPath?: string;
}

export interface DemoAgents {
  streamHash: string;
  generatedAt: string;
  items: DemoAgentCard[];
}

export interface Me extends Common {
  agentId: string;
  agentName?: string;
  grade?: string;
  orgPath?: string;
  months?: { from: string; to: string };
}

export interface MonthSummary {
  closeYm: string;
  status: MonthStatus;
  monthDataStatus: "OK" | "DRIFT" | "REBUILDING";
  gross: Won;
  clawbackOffset: Won;
  adjustment: Won;
  withholdingTax?: Won;
  net?: Won;
  netBasis?: NetBasis;
  paidAmount?: Won;
  paidAt?: string;
}

export interface Earnings extends Common {
  from: string;
  to: string;
  items: MonthSummary[];
}

export interface Month extends Common, MonthSummary {
  byType: Record<string, Won>;
  estimateAsOf?: string;
  confirmedAt?: string;
  receivableOffset?: Won;
  carriedReceivable?: Won;
  payable?: Won;
  payoutExpectedOn?: string;
  previous?: { closeYm: string; status: MonthStatus; gross: Won; net?: Won; netBasis?: NetBasis };
}

export interface Line {
  calcId: string;
  closeYm: string;
  commType: string;
  amount: Won;
  limitCutAmt: Won;
  limitCutPolicy?: string;
  productKey?: string;
  policyMasked: string;
  policyKey: string;
  reversalOf?: string;
  reversedBy?: string;
  reversalOfYm?: string;
  reversedByYm?: string;
}

export interface Lines extends Common {
  closeYm: string;
  page: number;
  size: number;
  total: number;
  items: Line[];
}

export type DeferralStatus = "SCHEDULED" | "RELEASED" | "HELD" | "CANCELLED";

export interface LineDetail extends Common {
  line: Line;
  basis: { rate?: string; payoutRate?: string; installmentNo?: number; ruleVersionIds: string[] };
  policySummary: { contractDate?: string; monthlyPremium?: Won };
  deferrals: { scheduleId: string; dueYm: string; amount: Won; status: DeferralStatus }[];
  receivable?: { receivableId: string; amount: Won; remaining: Won; status: string };
  ledgerId?: string;
  explanation: null;
}

export type Stage = "OK" | "WARN" | "CRIT" | "FULL";

export interface Ledger {
  ledgerId: string;
  policyMasked: string;
  contractDate: string;
  fyStart: string;
  fyEnd: string;
  monthlyPremium: Won;
  limitMultiple: string;
  limitAmount: Won;
  accumPaid: Won;
  remaining: Won;
  utilization?: string;
  stage: Stage;
  cutTotal: Won;
  deferredTotal: Won;
  flags: string[];
  productKey?: string;
}

export interface Limits extends Common {
  status: string;
  items: Ledger[];
}

export interface LimitDetail extends Common {
  ledger: Ledger;
  history: { sourceSeq: number; kind: "POST" | "REBASE"; calcId?: string; amount?: Won; accumAfter: Won; limitAfter: Won; reason?: string; occurredAt: string }[];
  explanation: null;
}

/** 세션이 없거나 스트림이 바뀌어 무효(401) — 화면은 설계사 선택으로. */
export class Unauthenticated extends Error {}
export class NotFound extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (res.status === 401) throw new Unauthenticated();
  if (res.status === 404) throw new NotFound();
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  demoAgents: () => call<DemoAgents>("/api/v1/demo/agents"),
  session: (demoAgent: 1 | 2 | 3) => call<{ asOf: AsOf; agentId: string }>("/api/v1/demo/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ demoAgent }) }),
  me: () => call<Me>("/api/v1/me"),
  earnings: (from: string, to: string) => call<Earnings>(`/api/v1/me/earnings?from=${from}&to=${to}`),
  month: (ym: string) => call<Month>(`/api/v1/me/earnings/${ym}`),
  lines: (ym: string, page: number) => call<Lines>(`/api/v1/me/earnings/${ym}/lines?page=${page}&size=200`),
  line: (calcId: string) => call<LineDetail>(`/api/v1/me/earnings/lines/${encodeURIComponent(calcId)}`),
  limits: () => call<Limits>("/api/v1/me/limits"),
  limit: (ledgerId: string) => call<LimitDetail>(`/api/v1/me/limits/${encodeURIComponent(ledgerId)}`),
};

/** 그 달 라인 전체(페이지를 total까지 — 상위 §8 명세: 같은 달 짝을 접으려면 전부 받는다). */
export async function allLines(ym: string): Promise<{ lines: Line[]; asOf: AsOf }> {
  const first = await api.lines(ym, 0);
  const lines = [...first.items];
  for (let page = 1; lines.length < first.total; page++) {
    const next = await api.lines(ym, page);
    if (next.items.length === 0) break;
    lines.push(...next.items);
  }
  return { lines, asOf: first.asOf };
}
