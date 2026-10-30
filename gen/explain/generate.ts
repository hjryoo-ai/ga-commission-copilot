// 설명 1건 생성 = 요청 → G1 → G4·G5·G6 → 실패면 위반 목록을 붙여 재생성 1회 → 재실패는 FAIL로 저장(설계서 v0.1.14 §4.1(b), PHASES Phase 3 항목 2·3).
// 호출기는 주입한다(실호출·VCR 재생·시험 가짜) — 이 파일은 LLM을 직접 부르지 않는다.
import { type GateResult, gateExplanation, type Json, normalizeText } from "@copilot/grounding";
import { canonicalHash } from "../providers/cassette.ts";
import { type ChatMessage, requestBody, type StructuredRequest } from "../providers/groq.ts";
import { loadPrompt, render } from "../providers/prompt.ts";
import { errorsOf, SCHEMA_IDS, schemaJson, validator } from "../world/schemas.ts";
import type { Kind } from "./context.ts";
import type { ExplanationRecord } from "./store.ts";

export const PROMPTS: Readonly<Record<Kind, { name: string; version: string }>> = {
  LINE: { name: "explain_line", version: "v2" },
  LIMIT: { name: "explain_limit", version: "v2" },
  MONTH_DIFF: { name: "explain_month", version: "v2" },
};
export const REPAIR_PROMPT = { name: "explain_repair", version: "v1" } as const;
const MAX_COMPLETION_TOKENS = 1500;

export const promptVersionOf = (kind: Kind) => `${PROMPTS[kind].name}/${PROMPTS[kind].version}`;

export interface Subject {
  tenantId: string;
  agentId: string;
  kind: Kind;
  subjectId: string;
}

export const labelOf = (s: Pick<Subject, "kind" | "agentId" | "subjectId">) => `explain:${s.kind}:${s.agentId}:${s.subjectId}`;

export interface LlmOutput {
  text: string;
  citedFields: string[];
  numbersUsed: string[];
}

/** 첫 요청(설계서 §6.3 — 프롬프트 파일 + 컨텍스트). model을 주면 model_hint 대신 쓴다(Workers AI). */
export function explainRequest(kind: Kind, context: Json, model?: string): { req: StructuredRequest; hash: string } {
  const p = loadPrompt(PROMPTS[kind].name, PROMPTS[kind].version);
  const req: StructuredRequest = {
    model: model ?? p.modelHint,
    messages: [{ role: "user", content: render(p.body, { context: JSON.stringify(context, null, 1) }) }],
    schemaName: "explanation",
    schema: schemaJson(p.outputSchema),
    maxCompletionTokens: MAX_COMPLETION_TOKENS,
  };
  return { req, hash: canonicalHash(requestBody(req)) };
}

export function violationsOf(g: GateResult, g1: string[] = []): string[] {
  return [...g1.map((x) => `G1 ${x}`), ...g.g4.map((x) => `G4 컨텍스트에 없는 숫자: ${x}`), ...g.g5.map((x) => `G5 컨텍스트에 없는 경로: ${x}`), ...g.g6.map((x) => `G6 금지: ${x}`)];
}

/** 재생성 요청: 첫 메시지 + 거부된 출력 + 위반 목록(prompts/explain_repair). */
export function repairRequest(base: StructuredRequest, rejected: unknown, violations: string[]): { req: StructuredRequest; hash: string } {
  const p = loadPrompt(REPAIR_PROMPT.name, REPAIR_PROMPT.version);
  const messages: ChatMessage[] = [
    ...base.messages,
    { role: "assistant", content: JSON.stringify(rejected) },
    { role: "user", content: render(p.body, { violations: violations.slice(0, 20).join("\n") }) },
  ];
  const req = { ...base, messages };
  return { req, hash: canonicalHash(requestBody(req)) };
}

/** G1(LLM 출력 스키마) + G4·G5·G6. */
export function gate(out: unknown, context: Json, agentId: string): { g1: string[]; gate: GateResult; output: LlmOutput | null } {
  const v = validator(SCHEMA_IDS.explainLlm);
  if (!v(out)) return { g1: [errorsOf(v)], gate: { status: "FAIL", g4: [], g5: [], g6: [] }, output: null };
  // 저장·표시할 본문은 NFKC + 서식 문자 제거본(검증기가 읽는 것과 같은 글자)
  const o = { ...(out as LlmOutput), text: normalizeText((out as LlmOutput).text) };
  return { g1: [], gate: gateExplanation(o, context, { ownAgentId: agentId }), output: o };
}

/** 호출기: 요청 → 원시 출력 + 공급자·모델. attempt 0 = 첫 요청, 1 = 재생성. */
export type Caller = (input: { label: string; attempt: 0 | 1; req: StructuredRequest; hash: string }) => Promise<{ json: unknown; provider: ExplanationRecord["provider"]; model: string; at?: string }>;

export async function generateOne(subject: Subject, streamHash: string, context: Json, call: Caller, model?: string, now = () => new Date().toISOString()): Promise<ExplanationRecord> {
  const label = labelOf(subject);
  const first = explainRequest(subject.kind, context, model);
  let r = await call({ label, attempt: 0, ...first });
  let g = gate(r.json, context, subject.agentId);
  let attempts: 1 | 2 = 1;
  if (g.g1.length || g.gate.status === "FAIL") {
    attempts = 2;
    const second = repairRequest(first.req, r.json, violationsOf(g.gate, g.g1));
    r = await call({ label: `${label}#retry`, attempt: 1, ...second });
    g = gate(r.json, context, subject.agentId);
  }
  const pass = g.g1.length === 0 && g.gate.status === "PASS";
  return {
    tenantId: subject.tenantId,
    agentId: subject.agentId,
    kind: subject.kind,
    subjectId: subject.subjectId,
    streamHash,
    promptVersion: promptVersionOf(subject.kind),
    provider: r.provider,
    model: r.model,
    text: g.output?.text ?? "",
    citedFields: g.output?.citedFields ?? [],
    numbersUsed: g.output?.numbersUsed ?? [],
    groundingStatus: pass ? "PASS" : "FAIL",
    attempts,
    ...(pass ? {} : { failure: { g4: [...g.g1.map((x) => `G1 ${x}`), ...g.gate.g4], g5: g.gate.g5, g6: g.gate.g6 } }),
    createdAt: r.at ?? now(),
  };
}
