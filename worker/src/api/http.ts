// 응답 공통(설계서 v0.1.12 §7 — 상위 §7 거부·캐시 규약 + 덧씌우기): problem+json, 공통 필드, ETag·304.
import type { Context } from "hono";
import type { ScopedQuery, StreamMeta } from "../db/ScopedQuery";

/** 설계서 §2.3·§7: 모든 응답의 고정 문구(web/src/disclaimer.ts와 같은 값). */
export const DISCLAIMER = "가상 데모 데이터 · 설계사 참고용 · 비확정 · 고객 제시 불가";

/** 세션 범위: 쿠키 서명 + 활성 스트림 demo_agents 대조를 통과한 설계사(api/session.ts). */
export interface Scope {
  q: ScopedQuery;
  stream: StreamMeta;
  agentId: string;
  demoNo: 1 | 2 | 3;
}

export type AppEnv = { Bindings: Env; Variables: { scope: Scope } };

type ProblemCode = "UNAUTHENTICATED" | "NOT_FOUND" | "INVALID_REQUEST" | "INTERNAL_ERROR";

// 사유와 무관하게 같은 바이트(상위 §7 거부·형식)
const MESSAGES: Record<ProblemCode, string> = {
  UNAUTHENTICATED: "데모 설계사를 먼저 선택하세요",
  NOT_FOUND: "찾을 수 없습니다",
  INVALID_REQUEST: "요청 형식이 올바르지 않습니다",
  INTERNAL_ERROR: "잠시 후 다시 시도하세요",
};

export function problem(c: Context, status: 400 | 401 | 404 | 500 | 503, code: ProblemCode): Response {
  return c.body(JSON.stringify({ code, message: MESSAGES[code] }), status, { "Content-Type": "application/problem+json", "Cache-Control": "no-store" });
}

export const unauthenticated = (c: Context) => problem(c, 401, "UNAUTHENTICATED");
export const notFound = (c: Context) => problem(c, 404, "NOT_FOUND");
export const invalidRequest = (c: Context) => problem(c, 400, "INVALID_REQUEST");

/** 공통 필드(asOf·dataStatus·disclaimer). Phase 2의 dataStatus는 OK뿐 — DEGRADED는 예산(Phase 4). */
export function common(s: Scope) {
  return { asOf: { streamHash: s.stream.streamHash, generatedAt: s.stream.generatedAt, demoNo: s.demoNo }, dataStatus: "OK" as const };
}

/** 200 + `private, no-cache` + 약한 ETag `W/"<streamHash>.<demoNo>"` + `Vary: Cookie`. 소유 확인을 마친 뒤에만 부른다 — 그때 If-None-Match를 본다. */
export function ok(c: Context<AppEnv>, body: object): Response {
  const s = c.get("scope");
  const etag = `W/"${s.stream.streamHash}.${s.demoNo}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache", Vary: "Cookie" };
  const inm = c.req.header("If-None-Match");
  if (inm && inm.split(",").some((t) => t.trim() === etag)) return c.body(null, 304, headers);
  return c.json({ ...common(s), ...body, disclaimer: DISCLAIMER }, 200, headers);
}

export const YM = /^[0-9]{4}(0[1-9]|1[0-2])$/;

/** 선택 필드는 값이 없으면 뺀다(상위 §7 — null을 보내지 않는다). */
export function compact<T extends Record<string, unknown>>(o: T): { [K in keyof T]: Exclude<T[K], null | undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as { [K in keyof T]: Exclude<T[K], null | undefined> };
}
