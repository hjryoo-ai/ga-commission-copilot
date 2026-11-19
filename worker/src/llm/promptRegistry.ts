// 프롬프트 레지스트리(설계서 §6.3, PHASES Phase 4 항목 3): prompts/<name>/v<N>.md(텍스트 모듈) frontmatter 파싱 + PROMPT_VERSIONS로 활성 버전 선택.
// 프롬프트 본문은 prompts/에만 있고 여기는 파일을 묶어 읽기만 한다(CLAUDE.md — 코드 문자열에 프롬프트를 쓰지 않는다). 새 버전 파일은 아래 FILES에 한 줄 추가.
import answerSchema from "../../../contracts/answer/v1/answer.schema.json";
import answerSchemaV2 from "../../../contracts/answer/v2/answer.schema.json";
import answerV1 from "../../../prompts/answer/v1.md";
import answerV2 from "../../../prompts/answer/v2.md";
import answerV3 from "../../../prompts/answer/v3.md";
import answerV4 from "../../../prompts/answer/v4.md";
import answerV5 from "../../../prompts/answer/v5.md";
import schemaHintV1 from "../../../prompts/schema_hint/v1.md";
import { promptVersions } from "../api/explain";

const FILES: Readonly<Record<string, string>> = { "answer/v1": answerV1, "answer/v2": answerV2, "answer/v3": answerV3, "answer/v4": answerV4, "answer/v5": answerV5, "schema_hint/v1": schemaHintV1 };
const SCHEMAS: Readonly<Record<string, object>> = { "contracts/answer/v1/answer.schema.json": answerSchema, "contracts/answer/v2/answer.schema.json": answerSchemaV2 };

export interface PromptFile {
  name: string;
  version: string;
  modelHint: string;
  maxContextTokens: number;
  outputSchema: object;
  /** 툴 결과 판(설계서 v0.1.44 §4.3.1 — frontmatter tool_results, 없으면 v1). */
  toolResults: "v1" | "v2";
  body: string;
}

/** frontmatter(name·version·model_hint·max_context_tokens·output_schema) + 본문. gen/providers/prompt.ts loadPrompt와 같은 규칙. */
export function parsePrompt(raw: string, where: string): PromptFile {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error(`${where}: frontmatter 없음`);
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (kv) meta[kv[1]!] = kv[2]!;
  }
  for (const k of ["name", "version", "model_hint", "max_context_tokens", "output_schema"]) if (!meta[k]) throw new Error(`${where}: frontmatter ${k} 없음`);
  const schema = SCHEMAS[meta.output_schema!];
  if (!schema) throw new Error(`${where}: output_schema ${meta.output_schema} 없음`);
  const toolResults = meta.tool_results ?? "v1";
  if (toolResults !== "v1" && toolResults !== "v2") throw new Error(`${where}: tool_results ${toolResults}`);
  return { name: meta.name!, version: meta.version!, modelHint: meta.model_hint!, maxContextTokens: Number(meta.max_context_tokens), outputSchema: schema, toolResults, body: m[2]! };
}

export function loadPrompt(name: string, version: string): PromptFile {
  const raw = FILES[`${name}/${version}`];
  if (raw === undefined) throw new Error(`prompts/${name}/${version}.md 없음(promptRegistry FILES)`);
  const p = parsePrompt(raw, `prompts/${name}/${version}.md`);
  if (p.name !== name || p.version !== version) throw new Error(`prompts/${name}/${version}.md: frontmatter ${p.name}/${p.version}`);
  return p;
}

/** 활성 버전(PROMPT_VERSIONS "answer=v1,…"). 설정이 없으면 v1. */
export function activePrompt(env: { PROMPT_VERSIONS?: string }, name: string): PromptFile {
  return loadPrompt(name, promptVersions(env)[name] ?? "v1");
}

/**
 * {{key}} 자리표시자를 채운다. 빠진 키는 오류. 값 안의 {{…}}는 다시 치환하지 않는다(한 번에 바꾼다).
 * 구역 {{#key}}…{{/key}}(설계서 v0.1.44 — answer/v4 단계별 본문): key 값이 비어 있지 않으면 안쪽을 남기고, 비면 구역째(뒤 줄바꿈 하나 포함) 뺀다. 구역이 없는 본문(v1~v3)은 그대로다.
 */
export function render(body: string, vars: Readonly<Record<string, string>>): string {
  const sections = body.replace(/\{\{#([a-z_0-9]+)\}\}\n?([\s\S]*?)\{\{\/\1\}\}\n?/g, (_, k: string, inner: string) => {
    if (!(k in vars)) throw new Error(`prompt 구역 ${k} 없음`);
    return vars[k] ? inner : "";
  });
  return sections.replace(/\{\{([a-z_]+)\}\}/g, (_, k: string) => {
    if (!(k in vars)) throw new Error(`prompt 변수 ${k} 없음`);
    return vars[k]!;
  });
}
