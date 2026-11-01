// 런타임 답변 파이프라인(설계서 §4.3·§4.4·§6.5, PHASES Phase 4 항목 3):
//   질의 임베딩(bge-m3) → Vectorize topK 6 · filter visibility=agent → LLM 1회(툴 계획 또는 바로 답/거부) → 툴(읽기 전용, 세션 설계사)
//   → 툴 결과가 있으면 LLM 1회 더(최종 답) → G4·G5·G6(실패면 NOT_GROUNDED 고정 문구) → answer_log(거부 포함 전건).
// 툴 결과는 <data>, 검색 청크는 <rules>로 감싼다 — 데이터이지 지시가 아니다(§6.5). 방어의 본체는 검증기: 답의 숫자는 툴 결과·청크 본문에 있어야 한다.
// 예산·폴백·캐시는 Phase 5(여기는 Groq만, fallback_depth 0, cache_hit 0).
import { contextKeys, contextNumbers, fieldInContext, forbiddenViolations, GroundingVerifier, type Json, normalizeText, withTextTokens } from "@copilot/grounding";
import { type RulebookChunkRow, rulebookChunks, type ScopedQuery } from "../db/ScopedQuery";
import { InvalidToolCall, parseToolCall, runTool, serialize, type ToolResult } from "../tools";
import { activePrompt, render } from "./promptRegistry";
import type { Provider } from "./providers";

export const REFUSE_REASONS = ["OUT_OF_SCOPE", "NOT_GROUNDED", "OTHER_AGENT", "NEEDS_ENGINE", "BUDGET"] as const;
export type RefuseReason = (typeof REFUSE_REASONS)[number];

/** 거부 사유별 사용자 문구(설계서 §4.4 — 고정). */
export const REFUSAL_TEXT: Readonly<Record<RefuseReason, string>> = {
  OUT_OF_SCOPE: "이 도우미는 수수료·한도·분급·환수에 대해서만 답합니다.",
  NOT_GROUNDED: "근거 데이터로 확인되지 않는 내용이 포함되어 답변을 보류했습니다. 라인 상세에서 직접 확인해 주세요.",
  OTHER_AGENT: "본인 데이터만 조회할 수 있습니다.",
  NEEDS_ENGINE: "이 질문은 정산 엔진의 시뮬레이션이 필요합니다. 데모에서는 준비된 계약만 지원합니다.",
  BUDGET: "오늘의 질문 예산이 소진되었습니다. 사전 생성된 설명은 계속 볼 수 있습니다.",
};

export const EMBED_MODEL = "@cf/baai/bge-m3";
export const TOP_K = 6;
export const MAX_TOOL_CALLS = 3;
const MAX_COMPLETION_TOKENS = 1200;
const QUESTION_MAX = 500;

export interface Citation {
  kind: "tool" | "rule";
  tool: string;
  field: string;
  article: string;
  chunkId: string;
}

/** LLM 출력(contracts/answer/v1/answer.schema.json). */
export interface AnswerOutput {
  refused: boolean;
  reason: Exclude<RefuseReason, "BUDGET"> | null;
  text: string;
  numbersUsed: string[];
  citations: Citation[];
  toolCalls: { tool: string; args: Record<string, string | null> }[];
}

export interface AnswerDeps {
  provider: Provider;
  /** 질의 임베딩(1024차원). */
  embed(text: string): Promise<number[]>;
  /** Vectorize topK · filter visibility=agent. */
  search(vector: number[], topK: number): Promise<{ id: string; score: number }[]>;
  /** 청크 본문(D1 rulebook_chunk — visibility=agent 행만). */
  chunks(ids: readonly string[]): Promise<RulebookChunkRow[]>;
  now(): Date;
  newId(): string;
}

export interface AnswerResult {
  answerId: string;
  refused: boolean;
  reason: RefuseReason | null;
  text: string;
  numbersUsed: string[];
  citations: Citation[];
  promptVersion: string;
  provider: string;
  model: string;
  groundingStatus: "PASS" | "FAIL" | "NONE";
  retrievedChunks: { chunkId: string; score: number }[];
  toolCalls: { tool: string; args: Record<string, string>; resultHash: string }[];
  /** 검증 실패 목록(G1·G4·G5·G6) — answer_log에는 남기지 않고 응답·시험에서만 본다. */
  violations: string[];
  latencyMs: number;
}

/** Cloudflare 바인딩으로 만든 기본 의존성(Workers AI 임베딩 · Vectorize · D1). */
export function cloudflareDeps(env: Env, provider: Provider): AnswerDeps {
  return {
    provider,
    async embed(text) {
      const r = (await env.AI.run(EMBED_MODEL, { text: [text] })) as { data?: number[][] };
      const v = r.data?.[0];
      if (!v) throw new Error("bge-m3 임베딩 없음");
      return v;
    },
    async search(vector, topK) {
      const r = await env.VECTORIZE.query(vector, { topK, filter: { visibility: "agent" }, returnMetadata: "none" });
      return r.matches.map((m) => ({ id: m.id, score: m.score }));
    },
    chunks: (ids) => rulebookChunks(env.DB, ids),
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
  };
}

/** 캐시 키·로그용 정규화(설계서 §6.4 — 공백·문장부호·숫자 표기 통일). 의미 유사 병합은 하지 않는다. */
export function normalizeQuestion(q: string): string {
  return normalizeText(q)
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[?？!.。…~]+$/u, "")
    .trim();
}

const isStr = (x: unknown): x is string => typeof x === "string";

/** G1(출력 모양) — worker에는 ajv를 싣지 않고 스키마의 필수 모양만 본다. 어긋나면 목록. */
export function shapeProblems(o: unknown): string[] {
  if (!o || typeof o !== "object" || Array.isArray(o)) return ["객체 아님"];
  const v = o as Record<string, unknown>;
  const out: string[] = [];
  if (typeof v.refused !== "boolean") out.push("refused");
  if (!(v.reason === null || (isStr(v.reason) && (REFUSE_REASONS as readonly string[]).includes(v.reason) && v.reason !== "BUDGET"))) out.push("reason");
  if (!isStr(v.text) || v.text.length > 800) out.push("text");
  if (!Array.isArray(v.numbersUsed) || !v.numbersUsed.every(isStr)) out.push("numbersUsed");
  const cites = v.citations;
  if (!Array.isArray(cites) || !cites.every((c) => c && typeof c === "object" && ["tool", "rule"].includes((c as Citation).kind) && ["tool", "field", "article", "chunkId"].every((k) => isStr((c as Record<string, unknown>)[k])))) out.push("citations");
  if (!Array.isArray(v.toolCalls) || !v.toolCalls.every((t) => t && typeof t === "object" && isStr((t as { tool: unknown }).tool) && (t as { args: unknown }).args && typeof (t as { args: unknown }).args === "object")) out.push("toolCalls");
  return out.map((k) => `G1 ${k}`);
}

async function hash16(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const rulesBlock = (rows: readonly RulebookChunkRow[]) => rows.map((r) => `[chunkId ${r.chunk_id}]\n${r.body}`).join("\n\n");
const dataBlock = (results: readonly ToolResult[]) => (results.length ? JSON.stringify(results.map((r) => ({ tool: r.tool, args: r.args, result: r.data }))) : "");

/** G4(툴 결과 + 청크 본문의 숫자) · G5(인용: 부른 툴의 키 / 검색된 청크) · G6(금지어·타 설계사 ID). */
export function groundAnswer(out: AnswerOutput, results: readonly ToolResult[], rows: readonly RulebookChunkRow[], ownAgentId: string): string[] {
  const s = withTextTokens(contextNumbers(results.map((r) => r.data) as Json), rows.map((r) => r.body));
  const g4 = GroundingVerifier.verify(out.text, s, { numbersUsed: out.numbersUsed }).missing.map((x) => `G4 근거에 없는 숫자: ${x}`);
  const g5: string[] = [];
  for (const c of out.citations) {
    if (c.kind === "tool") {
      const r = results.find((x) => x.tool === c.tool);
      if (!r || !fieldInContext(c.field, contextKeys(r.data as Json))) g5.push(`G5 툴 인용 ${c.tool}.${c.field}`);
    } else if (!rows.some((r) => r.chunk_id === c.chunkId && r.article === c.article)) g5.push(`G5 규정 인용 ${c.article} ${c.chunkId}`);
  }
  const g6 = forbiddenViolations(out.text, { ownAgentId }).map((x) => `G6 ${x}`);
  return [...g4, ...g5, ...g6];
}

export async function answerQuestion(deps: AnswerDeps, q: ScopedQuery, env: { PROMPT_VERSIONS?: string }, question: string): Promise<AnswerResult> {
  const started = deps.now().getTime();
  const qText = normalizeText(question).slice(0, QUESTION_MAX);
  const prompt = activePrompt(env, "answer");
  const promptVersion = `${prompt.name}/${prompt.version}`;

  const matches = await deps.search(await deps.embed(qText), TOP_K);
  const byId = new Map((await deps.chunks(matches.map((m) => m.id))).map((r) => [r.chunk_id, r]));
  const rows = matches.flatMap((m) => (byId.has(m.id) ? [byId.get(m.id)!] : []));
  const retrievedChunks = matches.filter((m) => byId.has(m.id)).map((m) => ({ chunkId: m.id, score: m.score }));

  const ask = (stage: string, data: string) =>
    deps.provider.structured({
      model: prompt.modelHint,
      messages: [{ role: "user", content: render(prompt.body, { stage, rules: rulesBlock(rows), data, question: qText }) }],
      schemaName: "answer",
      schema: prompt.outputSchema,
      maxCompletionTokens: MAX_COMPLETION_TOKENS,
    });

  let res = await ask("1단계", "");
  let violations = shapeProblems(res.json);
  let out = res.json as AnswerOutput;
  const results: ToolResult[] = [];
  if (violations.length === 0 && !out.refused && out.toolCalls.length > 0) {
    for (const raw of out.toolCalls.slice(0, MAX_TOOL_CALLS)) {
      // 해당 없는 인자(null)는 빼고 검사한다 — agentId 같은 인자는 스키마에도 없고 parseToolCall이 거부한다
      const args = Object.fromEntries(Object.entries(raw.args ?? {}).filter(([, v]) => v !== null));
      try {
        results.push(await runTool({ q }, parseToolCall({ tool: raw.tool, args })));
      } catch (e) {
        if (!(e instanceof InvalidToolCall)) throw e;
        violations.push(`툴 호출 거부: ${e.message}`);
      }
    }
    res = await ask("2단계", dataBlock(results));
    violations = shapeProblems(res.json);
    out = res.json as AnswerOutput;
  }

  let refused: boolean;
  let reason: RefuseReason | null;
  let text: string;
  let groundingStatus: AnswerResult["groundingStatus"];
  if (violations.some((v) => v.startsWith("G1"))) {
    [refused, reason, text, groundingStatus] = [true, "NOT_GROUNDED", REFUSAL_TEXT.NOT_GROUNDED, "FAIL"];
  } else if (out.refused) {
    // 거부 문구는 고정(§4.4) — 모델이 쓴 text는 쓰지 않는다
    reason = out.reason ?? "OUT_OF_SCOPE";
    [refused, text, groundingStatus] = [true, REFUSAL_TEXT[reason], "NONE"];
    violations = [];
  } else {
    const draft = { ...out, text: normalizeText(out.text) };
    violations = [...violations.filter((v) => !v.startsWith("툴 호출 거부")), ...groundAnswer(draft, results, rows, q.agentId)];
    if (violations.length) [refused, reason, text, groundingStatus] = [true, "NOT_GROUNDED", REFUSAL_TEXT.NOT_GROUNDED, "FAIL"];
    else [refused, reason, text, groundingStatus] = [false, null, draft.text, "PASS"];
  }

  const toolCalls = await Promise.all(results.map(async (r) => ({ tool: r.tool, args: r.args, resultHash: await hash16(serialize(r.data)) })));
  const result: AnswerResult = {
    answerId: deps.newId(),
    refused,
    reason,
    text,
    numbersUsed: refused ? [] : out.numbersUsed,
    citations: refused ? [] : out.citations,
    promptVersion,
    provider: deps.provider.name,
    model: res.model,
    groundingStatus,
    retrievedChunks,
    toolCalls,
    violations,
    latencyMs: deps.now().getTime() - started,
  };
  await logAnswer(deps, q, qText, result);
  return result;
}

/** answer_log 한 행(거부 포함 전건 — §4.4). */
async function logAnswer(deps: Pick<AnswerDeps, "now">, q: ScopedQuery, question: string, r: AnswerResult): Promise<void> {
  await q.insertAnswerLog({
    answerId: r.answerId,
    question,
    normalizedQuestion: normalizeQuestion(question),
    promptVersion: r.promptVersion,
    provider: r.provider,
    model: r.model,
    fallbackDepth: 0,
    retrievedChunks: JSON.stringify(r.retrievedChunks.map((c) => [c.chunkId, c.score])),
    toolCalls: JSON.stringify(r.toolCalls),
    answer: r.text,
    numbersUsed: JSON.stringify(r.numbersUsed),
    citations: JSON.stringify(r.citations),
    refused: r.refused,
    refuseReason: r.reason,
    groundingStatus: r.groundingStatus,
    latencyMs: r.latencyMs,
    cacheHit: false,
    createdAt: deps.now().toISOString(),
  });
}

/** LLM을 부르지 않는 거부(예산 소진 BUDGET — §4.4·§6.2). 고정 문구, provider·model "none", answer_log에 남긴다. */
export async function refuseWithoutLlm(deps: Pick<AnswerDeps, "now" | "newId">, q: ScopedQuery, env: { PROMPT_VERSIONS?: string }, question: string, reason: RefuseReason): Promise<AnswerResult> {
  const qText = normalizeText(question).slice(0, QUESTION_MAX);
  const prompt = activePrompt(env, "answer");
  const r: AnswerResult = {
    answerId: deps.newId(),
    refused: true,
    reason,
    text: REFUSAL_TEXT[reason],
    numbersUsed: [],
    citations: [],
    promptVersion: `${prompt.name}/${prompt.version}`,
    provider: "none",
    model: "none",
    groundingStatus: "NONE",
    retrievedChunks: [],
    toolCalls: [],
    violations: [],
    latencyMs: 0,
  };
  await logAnswer(deps, q, qText, r);
  return r;
}
