// 사규집 조항 1건 생성 = 요청 → G1 → G4·G6 → 실패면 위반 목록을 붙여 재생성 1회 → 재실패는 FAIL(설계서 §4.1(c)·§4.2).
// 호출기는 주입한다(실호출·VCR 재생·시험 가짜) — 이 파일은 LLM을 직접 부르지 않는다.
import type { Caller } from "../explain/generate.ts";
import { canonicalHash } from "../providers/cassette.ts";
import { type ChatMessage, requestBody, type StructuredRequest } from "../providers/groq.ts";
import { loadPrompt, render } from "../providers/prompt.ts";
import { schemaJson } from "../world/schemas.ts";
import { articleLabel, type ArticlePlan, type Visibility } from "./articles.ts";
import { gateArticle, violationsOf } from "./gate.ts";

export const RULEBOOK_PROMPT = { name: "rulebook", version: "v1" } as const;
export const RULEBOOK_REPAIR_PROMPT = { name: "rulebook_repair", version: "v1" } as const;
const MAX_COMPLETION_TOKENS = 2500;

export interface ArticleRecord {
  article: string;
  no: number;
  chapter: string;
  title: string;
  visibility: Visibility;
  body: string;
  numbersUsed: string[];
  promptVersion: string;
  provider: string;
  model: string;
  groundingStatus: "PASS" | "FAIL";
  attempts: 1 | 2;
  failure?: { g1: string[]; g4: string[]; g6: string[] };
  createdAt: string;
}

export const labelOfArticle = (no: number) => `rulebook:${articleLabel(no)}`;

const VISIBILITY_LABEL: Readonly<Record<Visibility, string>> = { agent: "설계사 열람", internal: "내부 관리용(설계사 검색 제외)" };

export function articleRequest(plan: ArticlePlan, model?: string): { req: StructuredRequest; hash: string } {
  const p = loadPrompt(RULEBOOK_PROMPT.name, RULEBOOK_PROMPT.version);
  const content = render(p.body, {
    article: articleLabel(plan.no),
    title: plan.title,
    chapter: plan.chapter,
    visibility: VISIBILITY_LABEL[plan.visibility],
    points: plan.points.map((x) => `- ${x}`).join("\n"),
    facts: JSON.stringify(plan.facts, null, 1),
  });
  const req: StructuredRequest = {
    model: model ?? p.modelHint,
    messages: [{ role: "user", content }],
    schemaName: "rulebook_article",
    schema: schemaJson(p.outputSchema),
    maxCompletionTokens: MAX_COMPLETION_TOKENS,
  };
  return { req, hash: canonicalHash(requestBody(req)) };
}

export function articleRepairRequest(base: StructuredRequest, rejected: unknown, violations: string[]): { req: StructuredRequest; hash: string } {
  const p = loadPrompt(RULEBOOK_REPAIR_PROMPT.name, RULEBOOK_REPAIR_PROMPT.version);
  const messages: ChatMessage[] = [...base.messages, { role: "assistant", content: JSON.stringify(rejected) }, { role: "user", content: render(p.body, { violations: violations.slice(0, 20).join("\n") }) }];
  const req = { ...base, messages };
  return { req, hash: canonicalHash(requestBody(req)) };
}

export async function generateArticle(plan: ArticlePlan, call: Caller, model?: string, now = () => new Date().toISOString()): Promise<ArticleRecord> {
  const label = labelOfArticle(plan.no);
  const first = articleRequest(plan, model);
  let r = await call({ label, attempt: 0, ...first });
  let g = gateArticle(r.json, plan);
  let attempts: 1 | 2 = 1;
  if (g.status === "FAIL") {
    attempts = 2;
    const second = articleRepairRequest(first.req, r.json, violationsOf(g));
    r = await call({ label: `${label}#retry`, attempt: 1, ...second });
    g = gateArticle(r.json, plan);
  }
  return {
    article: articleLabel(plan.no),
    no: plan.no,
    chapter: plan.chapter,
    title: plan.title,
    visibility: plan.visibility,
    body: g.output?.body ?? "",
    numbersUsed: g.output?.numbersUsed ?? [],
    promptVersion: `${RULEBOOK_PROMPT.name}/${RULEBOOK_PROMPT.version}`,
    provider: r.provider,
    model: r.model,
    groundingStatus: g.status,
    attempts,
    ...(g.status === "PASS" ? {} : { failure: { g1: g.g1, g4: g.g4, g6: g.g6 } }),
    createdAt: r.at ?? now(),
  };
}
