// GroundingVerifier(설계서 §6.1)와 G5·G6(§4.2). LLM 없이 결정론으로 판정한다 — gen(오프라인)과 worker(런타임)가 같은 코드를 쓴다.
import forbidden from "../forbidden.json" with { type: "json" };
import { type ContextNumbers, contextKeys, contextNumbers, fieldInContext, grounded, type Json, usedTokens } from "./context.ts";
import { extractTokens, type NumberToken } from "./numbers.ts";

export interface VerifyOptions {
  /** 컨텍스트 밖에서 허용할 값(호출자가 근거를 아는 것만). */
  extra?: readonly (number | string)[];
  /** 모델이 신고한 numbersUsed — 이것도 S 안이어야 PASS(설계서 §5.4 두 번째 불변식). */
  numbersUsed?: readonly (number | string)[];
}

export interface VerifyResult {
  status: "PASS" | "FAIL";
  /** S에 없는 토큰(텍스트 원문 표기). numbersUsed에서 온 것은 "numbersUsed:" 접두. */
  missing: string[];
  tokens: NumberToken[];
}

export const GroundingVerifier = {
  /** G4: 텍스트 숫자 토큰 T ⊆ 컨텍스트 숫자 집합 S. contextNumbers는 컨텍스트 값 또는 미리 만든 S. */
  verify(text: string, context: Json | ContextNumbers, options: VerifyOptions = {}): VerifyResult {
    const s = isNumbers(context) ? context : contextNumbers(context, options.extra);
    const tokens = extractTokens(text);
    const missing = tokens.filter((t) => !grounded(t.kind, t.value, s)).map((t) => t.raw);
    for (const u of options.numbersUsed ?? []) {
      const ts = usedTokens(u);
      if (ts.length === 0 && /\d/.test(String(u))) missing.push(`numbersUsed:${String(u)}`);
      for (const t of ts) if (!grounded(t.kind, t.value, s)) missing.push(`numbersUsed:${t.raw}`);
    }
    return { status: missing.length === 0 ? "PASS" : "FAIL", missing, tokens };
  },
};

function isNumbers(v: unknown): v is ContextNumbers {
  return typeof v === "object" && v !== null && (v as { numbers?: unknown }).numbers instanceof Set;
}

/** G5: citedFields ⊆ 컨텍스트 키. 컨텍스트에 없는 인용 필드 목록. */
export function unknownCitedFields(citedFields: readonly string[], context: Json): string[] {
  const keys = contextKeys(context);
  return citedFields.filter((f) => !fieldInContext(f, keys));
}

export interface ForbiddenOptions {
  /** 그 설명의 주인 설계사 ID — 자기 ID는 G6 대상이 아니다(§9 "다른 설계사 ID"). */
  ownAgentId?: string;
}

/** G6: 금지 표현·실존 보험사명·타 설계사 ID·증권번호 원문. 위반 목록("PHRASE:확정" 꼴). */
export function forbiddenViolations(text: string, options: ForbiddenOptions = {}): string[] {
  const out: string[] = [];
  for (const p of forbidden.phrases) if (text.includes(p)) out.push(`PHRASE:${p}`);
  for (const p of forbidden.insurers) if (text.includes(p)) out.push(`INSURER:${p}`);
  for (const p of forbidden.patterns) {
    for (const m of text.matchAll(new RegExp(`\\b${p.regex}\\b`, "g"))) {
      if (p.allowOwn && m[0] === options.ownAgentId) continue;
      out.push(`${p.name}:${m[0]}`);
    }
  }
  return out;
}

export interface GeneratedExplanation {
  text: string;
  citedFields: readonly string[];
  numbersUsed: readonly (number | string)[];
}

export interface GateResult {
  status: "PASS" | "FAIL";
  g4: string[];
  g5: string[];
  g6: string[];
}

/** 설명 한 건의 G4·G5·G6(설계서 §4.2). 셋 다 비어야 PASS. */
export function gateExplanation(e: GeneratedExplanation, context: Json, options: ForbiddenOptions & { extra?: readonly (number | string)[] } = {}): GateResult {
  const g4 = GroundingVerifier.verify(e.text, context, { extra: options.extra, numbersUsed: e.numbersUsed }).missing;
  const g5 = unknownCitedFields(e.citedFields, context);
  const g6 = forbiddenViolations(e.text, options);
  return { status: g4.length + g5.length + g6.length === 0 ? "PASS" : "FAIL", g4, g5, g6 };
}
