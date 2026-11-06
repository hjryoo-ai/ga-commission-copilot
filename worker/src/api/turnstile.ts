// Turnstile 봇 방지(설계서 v0.1.29 §9·§10.1, PHASES Phase 5 항목 5).
//   POST /api/v1/me/turnstile {token} → Siteverify(토큰 300초·1회용) 성공이면 24시간 서명 쿠키 → /ask는 그 쿠키가 있어야 받는다.
// TURNSTILE_SECRET(wrangler secret)이 없는 환경(로컬·시험)은 검사하지 않는다. 사이트 키는 공개 값(wrangler.jsonc var TURNSTILE_SITE_KEY).
// 쿠키 서명 키는 SESSION_SECRET에서 용도를 붙여 유도한다(세션 쿠키 값을 옮겨 붙여도 맞지 않게). 토큰·비밀은 로그·응답에 남기지 않는다.
import type { Context } from "hono";
import { getSignedCookie, setSignedCookie } from "hono/cookie";
import { type AppEnv, invalidRequest, problem } from "./http";

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const COOKIE = "copilot_human";
export const HUMAN_MAX_AGE_S = 24 * 60 * 60;
const TOKEN_MAX = 2048;
const TIMEOUT_MS = 5_000;

export type TurnstileEnv = Pick<Env, "TURNSTILE_SECRET" | "TURNSTILE_SITE_KEY" | "SESSION_SECRET">;

export const turnstileRequired = (env: Pick<Env, "TURNSTILE_SECRET">) => Boolean(env.TURNSTILE_SECRET);

const cookieKey = (secret: string) => `${secret}\u001fturnstile`;

export interface SiteverifyResult {
  success: boolean;
  hostname?: string;
  errorCodes: string[];
}

/** Siteverify 한 번(공식 문서: POST form secret·response·remoteip, 응답 success·hostname·error-codes). 네트워크·형식 오류는 던진다. */
export async function siteverify(secret: string, token: string, ip: string | null, fetcher: typeof fetch = fetch): Promise<SiteverifyResult> {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const res = await fetcher(SITEVERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`siteverify ${res.status}`);
  const b = (await res.json()) as { success?: unknown; hostname?: unknown; "error-codes"?: unknown };
  return {
    success: b.success === true,
    ...(typeof b.hostname === "string" ? { hostname: b.hostname } : {}),
    errorCodes: Array.isArray(b["error-codes"]) ? b["error-codes"].filter((x): x is string => typeof x === "string") : [],
  };
}

/** 이 요청에 유효한 사람 확인 쿠키가 있는가(서명 + 만료). 검사하지 않는 환경이면 늘 true. */
export async function humanVerified(c: Context<AppEnv>, now = Date.now()): Promise<boolean> {
  if (!turnstileRequired(c.env)) return true;
  const secret = c.env.SESSION_SECRET;
  if (!secret) return false;
  const v = await getSignedCookie(c, cookieKey(secret), COOKIE);
  if (typeof v !== "string" || !/^[0-9]{13}$/.test(v)) return false;
  return Number(v) > now;
}

/** /me의 turnstile 필드(설계서 v0.1.29) — 화면 4가 위젯을 그릴지 정한다. */
export async function turnstileStatus(c: Context<AppEnv>): Promise<{ required: boolean; verified: boolean; siteKey?: string }> {
  const required = turnstileRequired(c.env);
  return { required, verified: await humanVerified(c), ...(required && c.env.TURNSTILE_SITE_KEY ? { siteKey: c.env.TURNSTILE_SITE_KEY } : {}) };
}

/** POST /me/turnstile — me 라우터(세션 미들웨어 뒤). */
export async function postTurnstile(c: Context<AppEnv>, fetcher: typeof fetch = fetch): Promise<Response> {
  const body = (await c.req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token || token.length > TOKEN_MAX || Object.keys(body ?? {}).some((k) => k !== "token")) return invalidRequest(c);
  const secret = c.env.TURNSTILE_SECRET;
  const session = c.env.SESSION_SECRET;
  if (!secret) return c.json({ verified: true, required: false }, 200, { "Cache-Control": "no-store" });
  if (!session) return problem(c, 500, "INTERNAL_ERROR");
  let r: SiteverifyResult;
  try {
    r = await siteverify(secret, token, c.req.header("CF-Connecting-IP") ?? null, fetcher);
  } catch (e) {
    console.warn(`[turnstile] siteverify 실패: ${(e as Error).message.slice(0, 120)}`);
    return problem(c, 503, "INTERNAL_ERROR");
  }
  // 다른 호스트에서 받은 토큰은 받지 않는다(공식 문서 권장 — hostname 대조)
  const host = new URL(c.req.url).hostname;
  if (!r.success || (r.hostname !== undefined && r.hostname !== host)) {
    console.warn(`[turnstile] 거부: ${r.success ? "hostname" : r.errorCodes.join(",") || "fail"}`);
    return problem(c, 403, "TURNSTILE_REQUIRED");
  }
  const exp = Date.now() + HUMAN_MAX_AGE_S * 1000;
  await setSignedCookie(c, COOKIE, String(exp), cookieKey(session), { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: HUMAN_MAX_AGE_S });
  return c.json({ verified: true, required: true, expiresAt: new Date(exp).toISOString() }, 200, { "Cache-Control": "no-store" });
}
