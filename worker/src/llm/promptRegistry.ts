// 프롬프트 레지스트리(설계서 §6.3, PHASES Phase 4 항목 3): prompts/<name>/v<N>.md(텍스트 모듈) frontmatter 파싱 + PROMPT_VERSIONS로 활성 버전 선택.
// 프롬프트 본문은 prompts/에만 있고 여기는 파일을 묶어 읽기만 한다(CLAUDE.md — 코드 문자열에 프롬프트를 쓰지 않는다). 새 버전 파일은 아래 FILES에 한 줄 추가.
import answerSchema from "../../../contracts/answer/v1/answer.schema.json";
import answerV1 from "../../../prompts/answer/v1.md";
import answerV2 from "../../../prompts/answer/v2.md";
import answerV3 from "../../../prompts/answer/v3.md";
import schemaHintV1 from "../../../prompts/schema_hint/v1.md";
import { promptVersions } from "../api/explain";

const FILES: Readonly<Record<string, string>> = { "answer/v1": answerV1, "answer/v2": answerV2, "answer/v3": answerV3, "schema_hint/v1": schemaHintV1 };
const SCHEMAS: Readonly<Record<string, object>> = { "contracts/answer/v1/answer.schema.json": answerSchema };

export interface PromptFile {
  name: string;
  version: string;
  modelHint: string;
  maxContextTokens: number;
  outputSchema: object;
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
  return { name: meta.name!, version: meta.version!, modelHint: meta.model_hint!, maxContextTokens: Number(meta.max_context_tokens), outputSchema: schema, body: m[2]! };
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

/** {{key}} 자리표시자를 채운다. 빠진 키는 오류. 값 안의 {{…}}는 다시 치환하지 않는다(한 번에 바꾼다). */
export function render(body: string, vars: Readonly<Record<string, string>>): string {
  return body.replace(/\{\{([a-z_]+)\}\}/g, (_, k: string) => {
    if (!(k in vars)) throw new Error(`prompt 변수 ${k} 없음`);
    return vars[k]!;
  });
}
