// 일일 예산(설계서 v0.1.27 §6.2·§10.4, PHASES Phase 5 항목 1). 카운터는 D1 budget_counter(규약 5) — 갱신은 reserveBudget의
// `UPDATE … SET used = used + 1 WHERE … AND used < ?` 한 문장, 영향 행 0이면 소진.
//   범위: global(질문 1건에 1) · ip:<일일 솔트 해시>(질문 1건에 1) · provider:<이름>(HTTP 호출마다 1).
//   전역 상한 = min(BUDGET_GLOBAL, 공급자 상한 합) — Workers AI는 설명 배치와 뉴런을 나눠 써 배치 중 0(v0.1.27).
// 원문 IP는 어디에도 저장하지 않는다 — 날마다 바뀌는 솔트(SESSION_SECRET에서 HMAC으로 유도)로 해시한 앞 16자만 scope에 쓴다.
import { budgetRows, budgetUsed, reserveBudget } from "../db/ScopedQuery";

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
