// 일일 예산(설계서 v0.1.27 §6.2·§10.4, PHASES Phase 5 항목 1). 카운터는 D1 budget_counter(규약 5) — 갱신은 reserveBudget의
// `UPDATE … SET used = used + 1 WHERE … AND used < ?` 한 문장, 영향 행 0이면 소진.
//   범위: global(질문 1건에 1) · ip:<일일 솔트 해시>(질문 1건에 1) · provider:<이름>(HTTP 호출마다 1).
//   전역 상한 = min(BUDGET_GLOBAL, 공급자 상한 합) — Workers AI는 설명 배치와 뉴런을 나눠 써 배치 중 0(v0.1.27).
// 원문 IP는 어디에도 저장하지 않는다 — 날마다 바뀌는 솔트(SESSION_SECRET에서 HMAC으로 유도)로 해시한 앞 16자만 scope에 쓴다.
import { budgetRows, budgetRowsBetween, budgetUsed, reserveBudget } from "../db/ScopedQuery";

export const PROVIDER_ORDER = ["groq", "workers-ai", "openrouter"] as const;
export type BudgetProvider = (typeof PROVIDER_ORDER)[number];

/** PHASES Phase 5 항목 1의 기본값. Workers AI는 wrangler.jsonc에서 배치 중 "0"(v0.1.27). */
export const BUDGET_DEFAULTS = { global: 150, user: 10, groq: 55, "workers-ai": 80, openrouter: 15 } as const;

export interface BudgetCaps {
  global: number;
  user: number;
  providers: Record<BudgetProvider, number>;
}

export type BudgetEnv = Partial<Record<"BUDGET_GLOBAL" | "BUDGET_USER" | "BUDGET_GROQ" | "BUDGET_WORKERS_AI" | "BUDGET_OPENROUTER", string>>;

/** 0~9999 정수 문자열만 받는다. 없거나 형식이 틀리면 기본값(설정 실수로 무제한이 되지 않게 상한도 둔다). */
function capOf(v: string | undefined, fallback: number): number {
  return v !== undefined && /^(0|[1-9][0-9]{0,3})$/.test(v) ? Number(v) : fallback;
}

export function budgetCaps(env: BudgetEnv): BudgetCaps {
  const providers = {
    groq: capOf(env.BUDGET_GROQ, BUDGET_DEFAULTS.groq),
    "workers-ai": capOf(env.BUDGET_WORKERS_AI, BUDGET_DEFAULTS["workers-ai"]),
    openrouter: capOf(env.BUDGET_OPENROUTER, BUDGET_DEFAULTS.openrouter),
  };
  const sum = providers.groq + providers["workers-ai"] + providers.openrouter;
  return { global: Math.min(capOf(env.BUDGET_GLOBAL, BUDGET_DEFAULTS.global), sum), user: capOf(env.BUDGET_USER, BUDGET_DEFAULTS.user), providers };
}

/**
 * 키가 없는 공급자는 상한 0으로(시도·카운터를 쓰지 않게 — 예: OPENROUTER_API_KEY 등록 전), 전역도 다시 min.
 * Workers AI는 바인딩이라 키가 없다(상한만 본다).
 */
export function withKeys(caps: BudgetCaps, env: { GROQ_API_KEY?: string; OPENROUTER_API_KEY?: string }): BudgetCaps {
  const providers = { ...caps.providers, groq: env.GROQ_API_KEY ? caps.providers.groq : 0, openrouter: env.OPENROUTER_API_KEY ? caps.providers.openrouter : 0 };
  return { ...caps, providers, global: Math.min(caps.global, providers.groq + providers["workers-ai"] + providers.openrouter) };
}

export const utcDay = (now: Date) => now.toISOString().slice(0, 10);

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/**
 * 사용자 범위 키 `ip:<16 hex>`. 솔트 = HMAC-SHA256(SESSION_SECRET, "ip-salt:<UTC 날>") — 날이 바뀌면 같은 IP도 다른 키가 되어 날을 넘는 추적이 안 된다.
 * SESSION_SECRET이 없으면(시험 밖 설정 실수) 예외 — 솔트 없는 IP 해시는 쉽게 되돌릴 수 있다.
 */
export async function userScope(secret: string | undefined, ip: string, day: string): Promise<string> {
  if (!secret) throw new Error("SESSION_SECRET 없음 — 사용자 예산 키를 만들 수 없다");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const salt = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`ip-salt:${day}`)));
  return `ip:${hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}\u001f${ip}`))).slice(0, 16)}`;
}

/** 설계서 §7·v0.1.29: `/ask`는 IP당 분당 3회(예산과 별도 — WAF 대신 Worker 안에서 센다). */
export const RATE_PER_MINUTE = 3;

/** 분 키 `rl:<사용자 키>:<yyyymmddHHMM>`(UTC) — 사용자 키는 userScope의 `ip:<16 hex>`(원문 IP 없음). */
export function rateScope(user: string, now: Date): string {
  return `rl:${user}:${now.toISOString().slice(0, 16).replace(/[-T:]/g, "")}`;
}

export type RateReservation = { ok: true } | { ok: false; retryAfterSeconds: number };

/** 분당 1회 차감(같은 단일 UPDATE). 막히면 다음 분 시작까지 초(1~60). 하루 지난 행은 Cron이 지운다(purgeRateLimitRows). */
export async function reserveRate(db: D1Database, user: string, now: Date, cap = RATE_PER_MINUTE): Promise<RateReservation> {
  if (await reserveBudget(db, rateScope(user, now), utcDay(now), cap)) return { ok: true };
  return { ok: false, retryAfterSeconds: 60 - now.getUTCSeconds() };
}

export type QuestionReservation = { ok: true } | { ok: false; exhausted: "user" | "global" };

/**
 * 질문 1건 차감: 사용자 → 전역 순서(사용자 상한에 걸린 사람이 전역을 쓰지 않게). 전역에서 막히면 이미 센 사용자 1은 되돌리지 않는다
 * (규약 5 — 증가 한 문장만 두고 감소 경로는 만들지 않는다. 전역 소진 날 사용자 몫이 1 덜 남는 정도).
 */
export async function reserveQuestion(db: D1Database, caps: BudgetCaps, user: string, day: string): Promise<QuestionReservation> {
  if (!(await reserveBudget(db, user, day, caps.user))) return { ok: false, exhausted: "user" };
  if (!(await reserveBudget(db, "global", day, caps.global))) return { ok: false, exhausted: "global" };
  return { ok: true };
}

/** 공급자 호출 1회 차감 — 상한 0이면 D1에 쓰지 않고 바로 소진. */
export async function reserveProvider(db: D1Database, caps: BudgetCaps, provider: BudgetProvider, day: string): Promise<boolean> {
  const cap = caps.providers[provider];
  if (cap === 0) return false;
  return reserveBudget(db, `provider:${provider}`, day, cap);
}

export interface BudgetUsage {
  day: string;
  global: { used: number; cap: number };
  providers: Record<BudgetProvider, { used: number; cap: number }>;
}

/** 오늘 사용량(전역·공급자) — /me의 남은 횟수·/budget. 전역 표라 설계사 범위가 없다(budget_counter는 테넌트 열이 없는 운영 표). */
export async function usageOn(db: D1Database, caps: BudgetCaps, day: string): Promise<BudgetUsage> {
  const rows = await budgetRows(db, day);
  const used = (s: string) => rows.find((r) => r.scope === s)?.used ?? 0;
  return {
    day,
    global: { used: used("global"), cap: caps.global },
    providers: Object.fromEntries(PROVIDER_ORDER.map((p) => [p, { used: used(`provider:${p}`), cap: caps.providers[p] }])) as BudgetUsage["providers"],
  };
}

/** 시도할 수 있는 공급자가 있는가(차감 없이 읽기만) — 없으면 질문 임베딩(Workers AI)도 부르지 않고 저하 ①. */
export function anyProviderLeft(u: BudgetUsage): boolean {
  return PROVIDER_ORDER.some((p) => u.providers[p].cap > 0 && u.providers[p].used < u.providers[p].cap);
}

/** 이 사용자 키의 오늘 사용량. */
export async function userUsed(db: D1Database, user: string, day: string): Promise<number> {
  return budgetUsed(db, user, day);
}

/**
 * 답변 통계 카운터(설계서 v0.1.28 — 공개 /budget의 폴백 깊이·거부 사유·캐시·저하 분포). answer_log를 설계사 경계 없이 모으지 않도록(규약 3)
 * budget_counter(전역 운영 표)에 `stat:<이름>` 범위로 센다 — 같은 단일 UPDATE, 상한은 사실상 없음.
 */
export type StatName = `depth:${0 | 1 | 2}` | `refuse:${string}` | "cache:hit" | "cache:miss" | "degraded:rules";
const STAT_CAP = 1_000_000_000;
export async function countStat(db: D1Database, name: StatName, day: string): Promise<void> {
  // scope 형식은 소문자([a-z0-9:_-]) — 거부 코드(BUDGET 등)는 소문자로 저장하고 보고서에서 되돌린다
  await reserveBudget(db, `stat:${name.toLowerCase()}`, day, STAT_CAP);
}

export interface BudgetReport {
  today: BudgetUsage;
  days: { day: string; questions: number; providers: Record<BudgetProvider, number> }[];
  /** 기간 합 — 폴백 깊이(답한 공급자의 체인 순번)·거부 사유·캐시·저하. */
  fallbackDepth: Record<"0" | "1" | "2", number>;
  refusals: Record<string, number>;
  cache: { hit: number; miss: number };
  degraded: { rules: number };
}

/** 공개 /budget: 오늘 사용·상한 + 최근 n일(오늘 포함) 일별 공급자 사용·질문 수 + 분포. */
export async function budgetReport(db: D1Database, caps: BudgetCaps, now: Date, days = 7): Promise<BudgetReport> {
  const dayList = Array.from({ length: days }, (_, i) => utcDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1 - i)))));
  const rows = await budgetRowsBetween(db, dayList[0]!, dayList.at(-1)!);
  const at = (scope: string, day: string) => rows.find((r) => r.scope === scope && r.day === day)?.used ?? 0;
  const sum = (pred: (scope: string) => boolean) => rows.filter((r) => pred(r.scope)).reduce((n, r) => n + r.used, 0);
  const refusals: Record<string, number> = {};
  for (const r of rows) {
    if (!r.scope.startsWith("stat:refuse:")) continue;
    const code = r.scope.slice("stat:refuse:".length).toUpperCase();
    refusals[code] = (refusals[code] ?? 0) + r.used;
  }
  return {
    today: await usageOn(db, caps, dayList.at(-1)!),
    days: dayList.map((day) => ({ day, questions: at("global", day), providers: Object.fromEntries(PROVIDER_ORDER.map((p) => [p, at(`provider:${p}`, day)])) as Record<BudgetProvider, number> })),
    fallbackDepth: { "0": sum((s) => s === "stat:depth:0"), "1": sum((s) => s === "stat:depth:1"), "2": sum((s) => s === "stat:depth:2") },
    refusals,
    cache: { hit: sum((s) => s === "stat:cache:hit"), miss: sum((s) => s === "stat:cache:miss") },
    degraded: { rules: sum((s) => s === "stat:degraded:rules") },
  };
}
