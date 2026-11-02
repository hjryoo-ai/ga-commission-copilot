// G6 코드 이름 목록(운영자 2026-11-02 — 코드 노출은 사후 점검이 아니라 생성 게이트에서): packages/grounding/forbidden.json의 "codes".
//   node gen/scripts/forbidden-codes.ts        (gen: pnpm run forbidden:codes)
// 손으로 고치지 않는다 — 활성 설명 프롬프트 3종의 용어 표 코드 열 + 이벤트 계약 payload enum(explain/check-bodies.ts eventCodes와 같은 출처).
// 프롬프트·계약이 바뀌면 gen/test/forbidden-codes.test.ts(신선도)가 실패한다 → 이 스크립트를 다시 돌린다.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eventCodes } from "../explain/check-bodies.ts";
import { PROMPTS } from "../explain/generate.ts";
import { REPO_ROOT } from "../providers/prompt.ts";

export const FORBIDDEN_PATH = join(REPO_ROOT, "packages/grounding/forbidden.json");

/** 알파벳 순 — 파일 차이가 작게. */
export const currentCodes = (version = PROMPTS.LINE.version) => [...eventCodes(version)].sort();

/** forbidden.json 원문에서 "codes" 한 줄만 바꾼다(나머지 손 정렬 그대로). 없으면 "patterns" 앞에 넣는다. */
export function withCodes(text: string, codes: readonly string[]): string {
  const line = `  "codes": ${JSON.stringify(codes).replace(/","/g, '", "')},`;
  const out = /^ {2}"codes": \[.*\],$/m.test(text) ? text.replace(/^ {2}"codes": \[.*\],$/m, line) : text.replace(/^( {2}"patterns": )/m, `${line}\n$1`);
  const parsed = JSON.parse(out) as { codes?: unknown };
  if (JSON.stringify(parsed.codes) !== JSON.stringify(codes)) throw new Error("forbidden.json codes 쓰기 실패");
  return out;
}

function main(): void {
  const codes = currentCodes();
  writeFileSync(FORBIDDEN_PATH, withCodes(readFileSync(FORBIDDEN_PATH, "utf8"), codes));
  console.log(`${FORBIDDEN_PATH}: codes ${codes.length}개 — ${codes.join(" ")}`);
}

if (import.meta.main) main();
