// prompts/<name>/<version>.md 로더(CLAUDE.md: 프롬프트는 이 파일에만, 코드에는 데이터만).
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const REPO_ROOT = join(import.meta.dirname, "../..");

export interface PromptFile {
  name: string;
  version: string;
  modelHint: string;
  maxContextTokens: number;
  outputSchema: string;
  body: string;
}

export function loadPrompt(name: string, version: string): PromptFile {
  const raw = readFileSync(join(REPO_ROOT, "prompts", name, `${version}.md`), "utf8");
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`prompts/${name}/${version}.md: frontmatter 없음`);
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]!] = kv[2]!;
  }
  for (const k of ["name", "version", "model_hint", "max_context_tokens", "output_schema"]) {
    if (!meta[k]) throw new Error(`prompts/${name}/${version}.md: frontmatter ${k} 없음`);
  }
  return {
    name: meta.name!,
    version: meta.version!,
    modelHint: meta.model_hint!,
    maxContextTokens: Number(meta.max_context_tokens),
    outputSchema: meta.output_schema!,
    body: m[2]!,
  };
}

/** {{key}} 자리표시자를 채운다. 빠진 키·남은 자리표시자는 오류. */
export function render(body: string, vars: Readonly<Record<string, string>>): string {
  const out = body.replace(/\{\{([a-z_]+)\}\}/g, (_, k: string) => {
    if (!(k in vars)) throw new Error(`prompt 변수 ${k} 없음`);
    return vars[k]!;
  });
  return out;
}
