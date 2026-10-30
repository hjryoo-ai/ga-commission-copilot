// 사전 생성 설명을 응답 모양으로(설계서 v0.1.14 §7): 없으면 null, PASS면 본문·인용·숫자, FAIL이면 본문 없이 상태만(화면 "설명 없음").
// 활성 프롬프트 버전은 PROMPT_VERSIONS(설계서 §6.3 — "explain_line=v1,…"). 설명은 런타임에 LLM을 부르지 않는다(예산 0).
import type { ExplanationKind, ScopedQuery } from "../db/ScopedQuery";

const PROMPT_OF: Record<ExplanationKind, string> = { LINE: "explain_line", LIMIT: "explain_limit", MONTH_DIFF: "explain_month" };
const VERSION = /^v[1-9][0-9]*$/;

/** "explain_line=v1,answer=v5" → {explain_line: "v1", …}. 형식이 다른 조각은 버린다. */
export function promptVersions(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (env.PROMPT_VERSIONS ?? "").split(",")) {
    const [name, v] = part.split("=").map((x) => x.trim());
    if (name && /^[a-z_]+$/.test(name) && v && VERSION.test(v)) out[name] = v;
  }
  return out;
}

/** 그 종류의 활성 버전 "explain_line/v1"(설정이 없으면 v1). */
export function activePromptVersion(env: Env, kind: ExplanationKind): string {
  const name = PROMPT_OF[kind];
  return `${name}/${promptVersions(env)[name] ?? "v1"}`;
}

export type Explanation =
  | { groundingStatus: "PASS"; text: string; citedFields: string[]; numbersUsed: string[]; promptVersion: string; model: string }
  | { groundingStatus: "FAIL"; promptVersion: string };

function strings(s: string): string[] {
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function explanationOf(q: ScopedQuery, env: Env, kind: ExplanationKind, subjectId: string): Promise<Explanation | null> {
  const r = await q.explanation(kind, subjectId, activePromptVersion(env, kind));
  if (!r) return null;
  if (r.grounding_status !== "PASS") return { groundingStatus: "FAIL", promptVersion: r.prompt_version };
  return { groundingStatus: "PASS", text: r.text, citedFields: strings(r.cited_fields), numbersUsed: strings(r.numbers_used), promptVersion: r.prompt_version, model: r.model };
}
