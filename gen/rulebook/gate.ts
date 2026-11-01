// 사규집 조항 본문 게이트(설계서 §4.2 — 사규집은 G1·G6, 규약 1에 따라 숫자는 G4로 facts에 묶는다). LLM 없이 결정론.
import { type ContextNumbers, contextNumbers, forbiddenViolations, GroundingVerifier, type Json, normalizeText } from "@copilot/grounding";
import { errorsOf, SCHEMA_IDS, validator } from "../world/schemas.ts";
import type { ArticlePlan } from "./articles.ts";

export interface ArticleOutput {
  body: string;
  numbersUsed: string[];
}

export interface ArticleGate {
  status: "PASS" | "FAIL";
  g1: string[];
  g4: string[];
  g6: string[];
  output: ArticleOutput | null;
}

/**
 * 지시문 형태 텍스트(설계서 §6.5 — 사규집에 들어가면 G6에서 거른다). 런타임에 <rules>로 들어가는 글이라
 * 읽는 모델에게 명령하는 문장을 막는다. 규정 문체("~한다")의 일반 문장은 걸리지 않게 좁게 잡는다.
 */
export const INSTRUCTION_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: "무시 지시", re: /(?:지시|규칙|명령|규정)[^.\n]{0,12}무시/ },
  { name: "프롬프트", re: /프롬프트|시스템\s*메시지|system\s*prompt/i },
  { name: "출력 명령", re: /출력하(?:라|시오|세요)|답하(?:라|시오)|말하(?:라|시오)/ },
  { name: "모델 호칭", re: /(?:당신|너)(?:은|는|의|에게)\s/ },
  { name: "영문 지시", re: /\b(?:ignore|disregard|instruction|assistant)\b/i },
];

/** facts → S. 키가 Day·Days로 끝나는 값은 "N일"(기간·날) 토큰으로도 쓸 수 있다 — 공유 검증기의 일(day) 집합은 ISO 날짜에서만 채워지므로 여기서 더한다. */
export function factNumbers(facts: Json): ContextNumbers {
  const s = contextNumbers(facts);
  const days = new Set(s.days);
  const walk = (v: Json | undefined, key: string) => {
    if (Array.isArray(v)) for (const x of v) walk(x, key);
    else if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
    else if ((typeof v === "number" || typeof v === "string") && /Days?$/.test(key)) days.add(String(Number(v)));
  };
  walk(facts, "");
  return { ...s, days };
}

export function instructionViolations(text: string): string[] {
  return INSTRUCTION_PATTERNS.flatMap((p) => {
    const m = p.re.exec(text);
    return m ? [`INSTRUCTION(${p.name}):${m[0]}`] : [];
  });
}

/** G1(출력 스키마) → 본문 정규화 → G4(facts) · G6(금지어·지시문). */
export function gateArticle(out: unknown, plan: ArticlePlan): ArticleGate {
  const v = validator(SCHEMA_IDS.rulebookLlm);
  if (!v(out)) return { status: "FAIL", g1: [errorsOf(v)], g4: [], g6: [], output: null };
  const raw = out as ArticleOutput;
  // 줄바꿈을 JSON 이스케이프 글자(\\n)로 낸 출력은 실제 줄바꿈으로(서식만 — 목록 머리 "2. "가 줄 머리에 와야 숫자 토큰에서 빠진다). 줄 끝 공백은 지운다.
  const body = normalizeText(raw.body).replace(/\\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  const output = { body, numbersUsed: raw.numbersUsed };
  const g1 = output.body ? [] : ["body 비어 있음"];
  const g4 = GroundingVerifier.verify(output.body, factNumbers(plan.facts), { numbersUsed: output.numbersUsed }).missing;
  const g6 = [...forbiddenViolations(output.body), ...instructionViolations(output.body)];
  return { status: g1.length + g4.length + g6.length === 0 ? "PASS" : "FAIL", g1, g4, g6, output };
}

export function violationsOf(g: ArticleGate): string[] {
  return [...g.g1.map((x) => `G1 ${x}`), ...g.g4.map((x) => `G4 <data>에 없는 숫자: ${x}`), ...g.g6.map((x) => `G6 금지: ${x}`)];
}
