// 툴 공통(설계서 §4.3, PHASES Phase 4 항목 2): 결과 직렬화 ≤ 1,200토큰, 넘으면 목록(라인 요약 등)을 30건으로 자르고 그래도 넘으면 더 줄인다.
// 툴은 읽기 전용이다(규약 4 — 이 디렉터리에 쓰기 SQL 없음, 아키텍처 테스트). agentId는 ScopedQuery(세션)에서만 오고 인자에 없다.
import { policyMasked } from "../api/policy";
import type { ScopedQuery } from "../db/ScopedQuery";

export const TOOL_RESULT_MAX_TOKENS = 1200;
export const LIST_CUT = 30;

export interface ToolContext {
  q: ScopedQuery;
  /** 툴 결과 v2(설계서 v0.1.44 §4.3.1) — 목록을 줄이기 전 모양에 라벨·citable을 붙인다(1,200토큰 상한은 붙인 뒤 모양으로 잰다). */
  decorate?: (data: ToolData) => ToolData;
  /** 결과당 상한(approxTokens) — 기본 TOOL_RESULT_MAX_TOKENS. 2단계 합계 예산(설계서 v0.1.48)이 넘으면 answer.ts fitStage2가 줄여 다시 부른다. */
  max?: number;
}

export type ToolData = Record<string, unknown>;

/**
 * o200k(gpt-oss 계열) 토큰 수의 보수적 추정 — Worker 번들에 토크나이저(수 MB)를 넣지 않는다.
 * ASCII는 2.5자당 1토큰(JSON 키·숫자는 실측 약 3자당 1), 그 밖(한글 등)은 1자당 1토큰(실측 약 1.7자당 1)으로 크게 잡는다.
 */
export function approxTokens(s: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of s) {
    if (ch.charCodeAt(0) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 2.5) + other;
}

export const serialize = (data: ToolData) => JSON.stringify(data);

/**
 * 2단계 합계 예산용 o200k 추정(설계서 v0.1.48 — approxTokens보다 실측에 가깝게, 넘치지 않는 쪽으로). 계수는 60문항 오프라인 측정
 * (evals/scripts/tokens-offline.ts, 2026-11-19 answer/v5 58표본)에서 추정 ÷ 실측이 모든 표본 1.04 이상(최대 1.19)인 값 — 바꾸면 그 측정을 다시 돌린다.
 */
export const EST_ASCII_PER_TOKEN = 2.8;
export const EST_OTHER_PER_TOKEN = 1.2;
export function estimateTokens(s: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of s) {
    if (ch.charCodeAt(0) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / EST_ASCII_PER_TOKEN + other / EST_OTHER_PER_TOKEN);
}

/**
 * 목록 하나를 가진 결과를 예산 안에 맞춘다: 먼저 LIST_CUT건, 그래도 넘으면 반씩 줄인다.
 * 잘랐으면 `<key>Shown`·`<key>Total`을 붙여 모델이 "일부만 보인다"는 것을 알게 한다.
 */
export function fitList<T>(make: (items: readonly T[]) => ToolData, key: string, items: readonly T[], max = TOOL_RESULT_MAX_TOKENS): { data: ToolData; tokens: number; truncated: boolean } {
  const full = make(items);
  const fullTokens = approxTokens(serialize(full));
  if (fullTokens <= max) return { data: full, tokens: fullTokens, truncated: false };
  let n = Math.min(items.length, LIST_CUT);
  for (;;) {
    const data = { ...make(items.slice(0, n)), [`${key}Shown`]: n, [`${key}Total`]: items.length };
    const tokens = approxTokens(serialize(data));
    if (tokens <= max) return { data, tokens, truncated: true };
    if (n === 0) throw new Error(`tool result over ${max} tokens without ${key}`);
    n = Math.floor(n / 2);
  }
}

/** fitList + ctx.decorate(v2면 붙인 뒤 모양으로 상한을 잰다). */
export const fitIn = <T>(ctx: ToolContext, make: (items: readonly T[]) => ToolData, key: string, items: readonly T[]) =>
  fitList(ctx.decorate ? (xs: readonly T[]) => ctx.decorate!(make(xs)) : make, key, items, ctx.max ?? TOOL_RESULT_MAX_TOKENS);

const POLICY_NO = /^POL-\d{4}-\d{4,5}$/;

/** 깊은 복사하며 증권번호 원문 문자열을 마스킹한다(sim_stub 응답 등 외부 JSON — 툴 결과에도 증권번호 원문은 없다). */
export function maskDeep(v: unknown): unknown {
  if (typeof v === "string") return POLICY_NO.test(v) ? policyMasked(v) : v;
  if (Array.isArray(v)) return v.map(maskDeep);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x)]));
  return v;
}

/**
 * 증권번호 인자(뒷자리 마스킹 매칭 허용 — "***0001", "0001", "0001 계약") → 이 설계사 증권번호 중 끝 4자리가 같은 것.
 * 숫자 4자리 미만이면 빈 목록. 원문은 이 설계사 집합에서만 찾는다(남의 증권번호는 나올 수 없다).
 */
export function matchPolicies(own: readonly string[], input: string): string[] {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 4) return [];
  const tail = digits.slice(-4);
  return [...new Set(own)].filter((p) => p.slice(-4) === tail).sort();
}
