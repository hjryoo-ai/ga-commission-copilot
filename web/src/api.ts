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

/** 사전 생성 설명(설계서 v0.1.14 §7): PASS면 본문, FAIL이면 상태만. */
export type Explanation =
  | { groundingStatus: "PASS"; text: string; citedFields: string[]; numbersUsed: string[]; promptVersion: string; model: string }
  | { groundingStatus: "FAIL"; promptVersion: string };

export interface MonthDiff extends Common {
  closeYm: string;
  previousYm: string;
  promptVersion: string;
  explanation: Explanation | null;
}

export interface Me extends Common {
  agentId: string;
  agentName?: string;
  grade?: string;
  orgPath?: string;
  months?: { from: string; to: string };
  promptVersions?: Record<string, string>;
  /** 설계서 v0.1.27 §7: 오늘 남은 질문(전역·이 사용자). */
  budget?: MeBudget;
  /** 설계서 v0.1.29 §9: 사람 확인(Turnstile) — required면 화면 4가 위젯을 그리고, verified면 24시간 쿠키가 있다. */
  turnstile?: MeTurnstile;
}

export interface MeTurnstile {
  required: boolean;
  verified: boolean;
  siteKey?: string;
}

export interface MeBudget {
  remainingToday: number;
  userRemaining: number;
  resetsAt: string;
}

/** 칩·입력창이 쓰는 남은 질문 = 전역과 이 사용자 중 작은 쪽. */
export const questionsLeft = (b: Pick<MeBudget, "remainingToday" | "userRemaining">) => Math.min(b.remainingToday, b.userRemaining);

/** /ask 응답의 오늘 남은 질문(설계서 v0.1.33 — 그 요청을 센 뒤 값). */
export interface AskBudget {
  remainingToday: number;
  userRemaining: number;
}

/** 상단 칩 값: /me로 읽은 값에 가장 최근 /ask 응답 값을 덮는다(/me를 다시 부르지 않는다 — 설계서 v0.1.33). resetsAt은 /me 것. */
export function withAskBudget(me: MeBudget | undefined, latest: AskBudget | undefined): MeBudget | undefined {
  if (!me) return undefined;
  return latest ? { ...me, remainingToday: latest.remainingToday, userRemaining: latest.userRemaining } : me;
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
  explanation: Explanation | null;
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
  explanation: Explanation | null;
}

/** 거부 사유(설계서 §4.4 — v0.1.34 PROVIDER_ERROR 추가: 503 공급자 실패의 answer_log 행, 화면 7에서 본다) — 화면은 사유별 고정 문구(서버 text)와 대안 동선만. */
export type RefuseReason = "OUT_OF_SCOPE" | "NOT_GROUNDED" | "OTHER_AGENT" | "NEEDS_ENGINE" | "BUDGET" | "PROVIDER_ERROR";

/** 답변 인용: 툴 필드(tool·field) 또는 사규 조항(article·chunkId). 다른 쪽 칸은 빈 문자열. */
export interface Citation {
  kind: "tool" | "rule";
  tool: string;
  field: string;
  article: string;
  chunkId: string;
}

export interface ToolCallLog {
  tool: string;
  args: Record<string, string>;
  resultHash: string;
}

/** POST /me/ask 응답(설계서 §7). 429 BUDGET도 이 모양(retryAfterSeconds). */
export interface AskResult extends Common {
  answerId: string;
  refused: boolean;
  reason: RefuseReason | null;
  text: string;
  promptVersion: string;
  numbersUsed?: string[];
  citations?: Citation[];
  toolCalls?: ToolCallLog[];
  provider?: string;
  model?: string;
  groundingStatus?: "PASS" | "FAIL" | "NONE";
  cacheHit?: boolean;
  latencyMs?: number;
  retryAfterSeconds?: number;
  rulesUnavailable?: boolean;
  /** 설계서 v0.1.33: 200·429 BUDGET 모두 — 화면 4가 칩을 고친다. */
  budget?: AskBudget;
}

export interface Violations {
  /** 설계서 v0.1.26: 모양 오류 사유 코드(EMPTY_BODY·SHAPE:<키>·TOOL_ARG_REJECTED:<툴>·TOOL_IN_STAGE2:<툴>). v0.1.26 이전 행은 []. */
  g1Shape: string[];
  g4Missing: string[];
  g5Unknown: string[];
  g6Words: string[];
}

/** GET /answers/{id}(화면 7): 툴은 서버가 저장된 인자로 다시 실행 — reproduced = 답변 때 결과 해시와 같은가. */
export interface AnswerReplay extends Common {
  answerId: string;
  question: string;
  normalizedQuestion: string;
  answer: string | null;
  refused: boolean;
  reason: RefuseReason | null;
  groundingStatus: "PASS" | "FAIL" | "NONE";
  numbersUsed: string[];
  citations: Citation[];
  /** 설계서 v0.1.25(0006): 검증 위반 토큰 — 0006 이전 답변은 null. */
  violations: Violations | null;
  retrievedChunks: { chunkId: string; score: number; article?: string; title?: string; body?: string; version?: string }[];
  toolCalls: (ToolCallLog & { result?: unknown; truncated?: boolean; reproduced: boolean })[];
  promptVersion: string;
  provider: string;
  model: string;
  fallbackDepth: number;
  latencyMs: number;
  createdAt: string;
}

export type BudgetProvider = "groq" | "workers-ai" | "openrouter";

/** GET /api/v1/budget(화면 6 — 공개, 설계서 v0.1.28). */
export interface BudgetReport {
  /** global = 질문 단위, providers·calls = 호출 단위(설계서 v0.1.33 — 답 1건 = 호출 1~2회). */
  today: { day: string; global: { used: number; cap: number }; calls: { used: number; cap: number }; providers: Record<BudgetProvider, { used: number; cap: number }> };
  days: { day: string; questions: number; calls: number; providers: Record<BudgetProvider, number> }[];
  fallbackDepth: Record<"0" | "1" | "2", number>;
  refusals: Record<string, number>;
  cache: { hit: number; miss: number };
  degraded: { rules: number };
  disclaimer: string;
}

/** 공급자 실패(503) — 화면은 "잠시 후 다시". */
/** GET /api/v1/evals(화면 5 — 공개, PHASES Phase 6 항목 5). 율은 0~1, 4축은 normal 모드만(설계서 v0.1.40). */
export interface EvalAxis {
  n: number;
  pass: number;
  rate: number | null;
}
export interface EvalRates {
  grounding: number | null;
  refusal: number | null;
  tool: number | null;
  content: number | null;
}
export interface EvalRunSummary {
  runId: string;
  startedAt: string;
  trigger: string;
  promptVersions: Record<string, string>;
  streamHash: string;
  model: string;
  total: number;
  passed: number;
  rates: EvalRates;
  meanLatencyMs: number | null;
  /** 평균 지연에 하네스 대기(Groq 호출 간격)가 들어 있다 — 기준선·r1. */
  latencyIncludesWait: boolean;
  rulesUnavailable: { total: number; passed: number };
}
export interface EvalVariance {
  promptVersions: Record<string, string>;
  runs: { runId: string; startedAt: string; trigger: string }[];
  cases: { caseId: string; question: string | null; results: (boolean | null)[]; passes: number; n: number }[];
  distribution: Record<string, number>;
}
export interface EvalsReport {
  runs: EvalRunSummary[];
  variance: EvalVariance | null;
  disclaimer: string;
}
export type EvalBucket = "line" | "limit" | "deferral" | "rule" | "refusal";
export interface EvalAxes {
  total: number;
  passed: number;
  grounding: EvalAxis;
  refusal: EvalAxis;
  tool: EvalAxis;
  content: EvalAxis;
}
export interface EvalCase {
  caseId: string;
  mode: "normal" | "rulesUnavailable";
  bucket: EvalBucket;
  question: string | null;
  passed: boolean;
  failureKind: "GROUNDING" | "REFUSAL" | "TOOL" | "CONTENT" | "ERROR" | null;
  provider: string | null;
  refused: boolean | null;
  reason: string | null;
  groundingStatus: string | null;
  text: string | null;
  toolCalls: { tool: string; args: Record<string, string> }[];
  error: string | null;
  latencyMs: number | null;
  expectedTools: { tool: string; args: Record<string, string>; optional?: boolean }[];
  facts: string[];
  expectRefusal: boolean;
  expectReason: string | null;
  missingFacts: string[];
  forbiddenHits: string[];
  violations: { g1Shape?: string[]; g4Missing?: string[]; g5Unknown?: string[]; g6Words?: string[] } | null;
}
export interface EvalRunDetail {
  run: EvalRunSummary;
  byProvider: Record<string, EvalAxes>;
  byBucket: { bucket: EvalBucket; total: number; passed: number }[];
  cases: EvalCase[];
  rulesUnavailable: EvalCase[];
  disclaimer: string;
}

/** 503 — 공급자 실패(PROVIDER_ERROR, 설계서 v0.1.34: answerId로 거부 행을 재현 화면에서 본다, budget은 이미 1 줄어든 값) 또는 그 밖의 일시 장애. */
export class Unavailable extends Error {
  constructor(
    readonly answerId?: string,
    readonly budget?: AskBudget,
  ) {
    super("UNAVAILABLE");
  }
}

/** 사람 확인 쿠키가 없거나 만료(403 TURNSTILE_REQUIRED) — 화면은 위젯을 다시 그린다. */
export class HumanCheckRequired extends Error {}

/** 분당 질문 한도(429 RATE_LIMITED — 설계서 v0.1.29 §7). retryAfterSeconds = Retry-After(다음 분까지). */
export class RateLimited extends Error {
  constructor(
    readonly retryAfterSeconds: number,
    /** 설계서 v0.1.33: problem 본문의 budget(레이트 리밋은 예산을 쓰지 않는다 — 그대로인 값). */
    readonly budget?: AskBudget,
  ) {
    super("RATE_LIMITED");
  }
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
  diff: (ym: string) => call<MonthDiff>(`/api/v1/me/earnings/${ym}/diff`),
  lines: (ym: string, page: number) => call<Lines>(`/api/v1/me/earnings/${ym}/lines?page=${page}&size=200`),
  line: (calcId: string) => call<LineDetail>(`/api/v1/me/earnings/lines/${encodeURIComponent(calcId)}`),
  limits: () => call<Limits>("/api/v1/me/limits"),
  limit: (ledgerId: string) => call<LimitDetail>(`/api/v1/me/limits/${encodeURIComponent(ledgerId)}`),
  budget: () => call<BudgetReport>("/api/v1/budget"),
  evals: () => call<EvalsReport>("/api/v1/evals"),
  evalRun: (runId: string) => call<EvalRunDetail>(`/api/v1/evals/${encodeURIComponent(runId)}`),
  answer: (answerId: string) => call<AnswerReplay>(`/api/v1/answers/${encodeURIComponent(answerId)}`),
  /** 429(예산 소진 BUDGET)는 오류가 아니라 거부 답 — 본문을 그대로 돌려준다. 같은 429라도 problem+json RATE_LIMITED(분당 한도)는 RateLimited. */
  async ask(question: string): Promise<AskResult> {
    const res = await fetch("/api/v1/me/ask", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
    if (res.status === 401) throw new Unauthenticated();
    if (res.status === 403) throw new HumanCheckRequired();
    if (res.status === 503) {
      const p = (await res.json().catch(() => ({}))) as { answerId?: unknown; budget?: AskBudget };
      throw new Unavailable(typeof p.answerId === "string" ? p.answerId : undefined, p.budget);
    }
    if (res.status === 429 && (res.headers.get("Content-Type") ?? "").startsWith("application/problem+json")) {
      const p = (await res.json().catch(() => ({}))) as { budget?: AskBudget };
      throw new RateLimited(Number(res.headers.get("Retry-After")) || 60, p.budget);
    }
    if (!res.ok && res.status !== 429) throw new Error(`${res.status}`);
    return (await res.json()) as AskResult;
  },
  /** Turnstile 토큰 → 서버 Siteverify → 24시간 쿠키(설계서 v0.1.29). 403이면 HumanCheckRequired. */
  async turnstile(token: string): Promise<void> {
    const res = await fetch("/api/v1/me/turnstile", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    if (res.status === 401) throw new Unauthenticated();
    if (res.status === 403) throw new HumanCheckRequired();
    if (!res.ok) throw new Error(`${res.status}`);
  },
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
