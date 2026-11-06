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
  /** 검증 실패 목록(G1·G4·G5·G6, 사람이 읽는 문장) — 응답·시험에서 본다. */
  violations: string[];
  /** G4·G5·G6 위반 토큰(설계서 v0.1.25 — answer_log.violations, 화면 7). 거부·PASS면 빈 배열. */
  grounding: GroundingViolations;
  latencyMs: number;
  /** 규정 검색(임베딩·Vectorize)이 실패해 규정 없이 툴만으로 답했다(운영자 2026-11-03 — Phase 5 전 임시, 설계서 v0.1.22 §4.3). */
  rulesUnavailable: boolean;
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

/** 툴 결과 해시(answer_log.tool_calls.resultHash) — 화면 7 재현이 같은 함수로 대조한다. */
export async function hash16(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 프롬프트 <session>(answer/v2 — 운영자 2026-11-03, v1 녹화의 연도 추정·"이 계약" 실패에서): 이 설계사의 명세 달 목록·계약 끝 4자리·해약 시뮬레이션 준비 계약.
 * 툴 인자를 고르는 데만 쓰고 G4 근거(S)에 넣지 않는다 — 여기 숫자를 본문에 쓰려면 툴로 읽어야 한다. v1 본문에는 {{session}}이 없어 쓰이지 않는다.
 */
/** limitCut: v3부터(프롬프트가 "한도 삭감이 있었던 계약"을 쓸 때만 — v2 카세트 요청이 바뀌지 않게). */
export async function sessionBlock(q: ScopedQuery, limitCut = true): Promise<string> {
  const [months, ledgers, cut, sims] = await Promise.all([
    q.all<{ close_ym: string }>("earnings_month", { columns: ["close_ym"], orderBy: "close_ym" }),
    q.all<{ policy_no: string }>("policy_limit", { columns: ["policy_no"], orderBy: "policy_no" }),
    // answer/v3(A-02·A-04 — 계약을 특정하지 않은 한도 질문의 get_limit 인자): 한도 삭감 라인이 있는 계약
    limitCut ? q.all<{ policy_no: string }>("earnings_line", { columns: ["policy_no"], distinct: true, where: { limit_cut_amt: [">", 0] }, orderBy: "policy_no" }) : null,
    q.simStubPolicies("POLICY_EVENT"),
  ]);
  const tail = (p: string) => p.slice(-4);
  return [
    `명세가 있는 달(yyyyMM): ${months.map((m) => m.close_ym).join(", ") || "없음"}`,
    `계약(증권번호 끝 4자리): ${ledgers.map((l) => tail(l.policy_no)).join(", ") || "없음"}`,
    ...(cut ? [`한도 삭감이 있었던 계약(끝 4자리): ${cut.map((l) => tail(l.policy_no)).join(", ") || "없음"}`] : []),
    `해약 시뮬레이션이 준비된 계약(끝 4자리): ${sims.map(tail).join(", ") || "없음"}`,
  ].join("\n");
}

const rulesBlock = (rows: readonly RulebookChunkRow[]) => rows.map((r) => `[chunkId ${r.chunk_id}]\n${r.body}`).join("\n\n");
const dataBlock = (results: readonly ToolResult[]) => (results.length ? JSON.stringify(results.map((r) => ({ tool: r.tool, args: r.args, result: r.data }))) : "");

/**
 * 규정 인용의 조항 번호(운영자 2026-11-03 — G5는 조항 번호로 대조): "제7조"·"제25조(환수율)"·"7"·"rb-07"·"rb-0453f7d205db-a25-1" → 7·25.
 * 조항 = 청크 1:1(§14.0)이라 번호가 같으면 같은 청크다. 못 읽으면 null.
 */
export function articleNo(s: string): number | null {
  const t = s.trim();
  const m = t.match(/^제\s*(\d+)\s*조/) ?? t.match(/^(\d+)$/) ?? t.match(/^rb-(?:[0-9a-f]{12}-)?a?(\d+)(?:-\d+)?$/);
  return m ? Number(m[1]) : null;
}

/** 규정 인용 → 검색된 청크(조항 번호 일치). article이 비거나 못 읽으면 chunkId로. */
function citedRow(c: Citation, rows: readonly RulebookChunkRow[]): RulebookChunkRow | undefined {
  const n = articleNo(c.article) ?? articleNo(c.chunkId);
  return n === null ? undefined : rows.find((r) => articleNo(r.article) === n);
}

/** 통과한 답의 규정 인용을 검색된 청크의 정본 표기(article·chunkId)로 — answer_log·응답이 같은 모양. */
export const canonicalCitations = (cs: readonly Citation[], rows: readonly RulebookChunkRow[]): Citation[] =>
  cs.map((c) => {
    if (c.kind !== "rule") return c;
    const r = citedRow(c, rows)!;
    return { ...c, article: r.article, chunkId: r.chunk_id };
  });

/**
 * answer_log.violations(0006) 모양 — 토큰 그대로(G4 근거 없는 숫자, G5 확인 안 된 인용 "tool.field"·"article chunkId", G6 금지어·코드).
 * g1Shape(설계서 v0.1.26): 실패한 답의 모양 오류 사유 코드 — `SHAPE:<키>`(스키마 모양), `EMPTY_BODY`(거부 아닌 빈 본문),
 * `TOOL_ARG_REJECTED:<툴>`(1단계 툴 인자 검사 거부), `TOOL_IN_STAGE2:<툴>`(2단계가 툴을 더 요청). 진단 기록이다 — 게이트 판정은 바꾸지 않고, PASS면 빈 배열.
 */
export interface GroundingViolations {
  g1Shape: string[];
  g4Missing: string[];
  g5Unknown: string[];
  g6Words: string[];
}
export const NO_VIOLATIONS: GroundingViolations = Object.freeze({ g1Shape: [], g4Missing: [], g5Unknown: [], g6Words: [] }) as GroundingViolations;

/** G4(툴 결과 + 청크 본문의 숫자) · G5(인용: 부른 툴의 키 경로 / 검색된 청크의 조항 번호) · G6(금지어·타 설계사 ID) — 토큰 단위. */
export function groundAnswerDetail(out: AnswerOutput, results: readonly ToolResult[], rows: readonly RulebookChunkRow[], ownAgentId: string): GroundingViolations {
  const s = withTextTokens(contextNumbers(results.map((r) => r.data) as Json), rows.map((r) => r.body));
  const g4Missing = GroundingVerifier.verify(out.text, s, { numbersUsed: out.numbersUsed }).missing;
  const g5Unknown: string[] = [];
  for (const c of out.citations) {
    if (c.kind === "tool") {
      const r = results.find((x) => x.tool === c.tool);
      if (!r || !fieldInContext(c.field, contextKeys(r.data as Json))) g5Unknown.push(`${c.tool}.${c.field}`);
    } else if (!citedRow(c, rows)) g5Unknown.push(`${c.article} ${c.chunkId}`);
  }
  return { g1Shape: [], g4Missing, g5Unknown, g6Words: forbiddenViolations(out.text, { ownAgentId }) };
}

/** 위반 토큰 → 사람이 읽는 문장(응답·시험의 violations). */
export function violationLines(v: GroundingViolations, out?: AnswerOutput): string[] {
  // 토큰이 툴 인용("tool.field")인지 규정 인용("article chunkId")인지는 원래 인용에서 가린다
  const isTool = (t: string) => (out ? out.citations.some((c) => c.kind === "tool" && `${c.tool}.${c.field}` === t) : /^get_/.test(t));
  const g5 = v.g5Unknown.map((t) => `G5 ${isTool(t) ? "툴" : "규정"} 인용 ${t}`);
  return [...v.g4Missing.map((x) => `G4 근거에 없는 숫자: ${x}`), ...g5, ...v.g6Words.map((x) => `G6 ${x}`)];
}

export function groundAnswer(out: AnswerOutput, results: readonly ToolResult[], rows: readonly RulebookChunkRow[], ownAgentId: string): string[] {
  return violationLines(groundAnswerDetail(out, results, rows, ownAgentId), out);
}

export async function answerQuestion(deps: AnswerDeps, q: ScopedQuery, env: { PROMPT_VERSIONS?: string }, question: string): Promise<AnswerResult> {
  const started = deps.now().getTime();
  const qText = normalizeText(question).slice(0, QUESTION_MAX);
  const prompt = activePrompt(env, "answer");
  const promptVersion = `${prompt.name}/${prompt.version}`;

  // 임시(운영자 2026-11-03, Phase 5 전): 임베딩·검색이 실패하면(Workers AI 4006 — 그날 뉴런 소진 등) 규정 없이 툴만으로 답한다.
  // 배치가 뉴런을 다 쓴 날 공개 데모 /ask가 500으로 죽지 않게. <rules>가 비므로 규정 인용은 G5에서 0건만 통과한다. 정식 저하 모드는 Phase 5.
  let matches: { id: string; score: number }[] = [];
  let rulesUnavailable = false;
  try {
    matches = await deps.search(await deps.embed(qText), TOP_K);
  } catch (e) {
    rulesUnavailable = true;
    console.warn(`[answer] 규정 검색 실패 — 규정 없이 툴만으로: ${(e as Error).message.slice(0, 200)}`);
  }
  const byId = new Map((await deps.chunks(matches.map((m) => m.id))).map((r) => [r.chunk_id, r]));
  const rows = matches.flatMap((m) => (byId.has(m.id) ? [byId.get(m.id)!] : []));
  const retrievedChunks = matches.filter((m) => byId.has(m.id)).map((m) => ({ chunkId: m.id, score: m.score }));

  const session = prompt.body.includes("{{session}}") ? await sessionBlock(q, prompt.body.includes("한도 삭감이 있었던 계약")) : "";
  const ask = (stage: string, data: string) =>
    deps.provider.structured({
      model: prompt.modelHint,
      messages: [{ role: "user", content: render(prompt.body, { stage, session, rules: rulesBlock(rows), data, question: qText }) }],
      schemaName: "answer",
      schema: prompt.outputSchema,
      maxCompletionTokens: MAX_COMPLETION_TOKENS,
    });

  let res = await ask("1단계", "");
  let violations = shapeProblems(res.json);
  let out = res.json as AnswerOutput;
  const results: ToolResult[] = [];
  // g1Shape 진단(설계서 v0.1.26) — 판정에는 쓰지 않는다
  const rejectedTools: string[] = [];
  let stage2Tools: string[] = [];
  if (violations.length === 0 && !out.refused && out.toolCalls.length > 0) {
    for (const raw of out.toolCalls.slice(0, MAX_TOOL_CALLS)) {
      // 해당 없는 인자(null)는 빼고 검사한다 — agentId 같은 인자는 스키마에도 없고 parseToolCall이 거부한다
      const args = Object.fromEntries(Object.entries(raw.args ?? {}).filter(([, v]) => v !== null));
      try {
        results.push(await runTool({ q }, parseToolCall({ tool: raw.tool, args })));
      } catch (e) {
        if (!(e instanceof InvalidToolCall)) throw e;
        violations.push(`툴 호출 거부: ${e.message}`);
        rejectedTools.push(`TOOL_ARG_REJECTED:${String(raw.tool)}`);
      }
    }
    res = await ask("2단계", dataBlock(results));
    violations = shapeProblems(res.json);
    out = res.json as AnswerOutput;
    if (violations.length === 0) stage2Tools = out.toolCalls.map((t) => `TOOL_IN_STAGE2:${String(t.tool)}`);
  }

  let refused: boolean;
  let reason: RefuseReason | null;
  let text: string;
  let groundingStatus: AnswerResult["groundingStatus"];
  let grounding = NO_VIOLATIONS;
  if (violations.some((v) => v.startsWith("G1"))) {
    [refused, reason, text, groundingStatus] = [true, "NOT_GROUNDED", REFUSAL_TEXT.NOT_GROUNDED, "FAIL"];
    grounding = { ...NO_VIOLATIONS, g1Shape: [...violations.filter((v) => v.startsWith("G1 ")).map((v) => `SHAPE:${v.slice(3)}`), ...rejectedTools] };
  } else if (out.refused) {
    // 거부 문구는 고정(§4.4) — 모델이 쓴 text는 쓰지 않는다
    reason = out.reason ?? "OUT_OF_SCOPE";
    [refused, text, groundingStatus] = [true, REFUSAL_TEXT[reason], "NONE"];
    violations = [];
  } else {
    const draft = { ...out, text: normalizeText(out.text) };
    // 거부가 아닌데 본문이 비면 답이 없는 것이다 — 숫자가 없어 G4가 비어 통과하는 구멍(2026-11-03 녹화 A-02: 2단계가 툴을 더 요청하고 text "")
    const empty = draft.text.trim() === "" ? ["G1 text 비어 있음(거부 아닌 빈 답)"] : [];
    grounding = groundAnswerDetail(draft, results, rows, q.agentId);
    violations = [...violations.filter((v) => !v.startsWith("툴 호출 거부")), ...empty, ...violationLines(grounding, draft)];
    if (violations.length) {
      [refused, reason, text, groundingStatus] = [true, "NOT_GROUNDED", REFUSAL_TEXT.NOT_GROUNDED, "FAIL"];
      grounding = { ...grounding, g1Shape: [...(empty.length ? ["EMPTY_BODY"] : []), ...rejectedTools, ...stage2Tools] };
    } else [refused, reason, text, groundingStatus] = [false, null, draft.text, "PASS"];
  }

  const toolCalls = await Promise.all(results.map(async (r) => ({ tool: r.tool, args: r.args, resultHash: await hash16(serialize(r.data)) })));
  const result: AnswerResult = {
    answerId: deps.newId(),
    refused,
    reason,
    text,
    numbersUsed: refused ? [] : out.numbersUsed,
    citations: refused ? [] : canonicalCitations(out.citations, rows),
    promptVersion,
    provider: deps.provider.name,
    model: res.model,
    groundingStatus,
    retrievedChunks,
    toolCalls,
    rulesUnavailable,
    violations,
    grounding,
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
    violations: JSON.stringify(r.grounding),
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
    grounding: NO_VIOLATIONS,
    latencyMs: 0,
    rulesUnavailable: false,
  };
  await logAnswer(deps, q, qText, r);
  return r;
}
