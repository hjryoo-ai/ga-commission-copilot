// 설명 본문 점검(운영자 2026-11-02 — 세션 scratchpad의 scan_bodies.py를 저장소로 옮김. 게이트가 아니라 참고 — G4~G6 밖의 뜻 품질).
//   node explain/check-bodies.ts [--stream <sha256>] [--version v6] [--bodies] [--dir <data/explain>]
//   → 정규식 요약(①~④·v5·v6 항목 + ③ 코드 이름) · 한도 정해진 문장 · 수동 확인 구절 · 문장 수. 출력 모양은 scan_bodies.py와 같다(날짜별 로그 비교).
// ③ 코드 이름: 설명 프롬프트 용어 표의 코드 열(왼쪽 열의 대문자 코드)에서 자동으로 만든다 + 이벤트 계약 payload의 문자열 enum(용어 표에 없는 LIMIT_DEFER 등).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../providers/prompt.ts";
import { pickStream } from "../load/views.ts";
import { PROMPTS } from "./generate.ts";
import { DATA_EXPLAIN, type ExplanationRecord, KINDS } from "./store.ts";

export const FIXED_DEFER_SENTENCE = "이연분의 지급 시점은 데이터로는 확인되지 않습니다";
const CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*\b/g;

/** 용어 표 코드 열의 코드: 표 행(`| … | … |`)의 첫 칸에서 대문자 코드만. */
export function glossaryCodes(promptText: string): string[] {
  const out = new Set<string>();
  for (const line of promptText.split("\n")) {
    const cells = line.split("|");
    if (!line.startsWith("|") || cells.length < 3) continue;
    for (const m of cells[1]!.matchAll(CODE)) if (m[0].length >= 2) out.add(m[0]);
  }
  return [...out].sort();
}

/** 이벤트 계약 payload 스키마의 문자열 enum 중 대문자 코드(UPPER_SNAKE). */
export function contractEnumCodes(dir = join(REPO_ROOT, "contracts/events/v1/payloads")): string[] {
  const out = new Set<string>();
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== "object") return;
    const enumValues = (o as { enum?: unknown }).enum;
    if (Array.isArray(enumValues)) for (const v of enumValues) if (typeof v === "string" && /^[A-Z][A-Z0-9_]+$/.test(v)) out.add(v);
    Object.values(o).forEach(walk);
  };
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) walk(JSON.parse(readFileSync(join(dir, f), "utf8")));
  return [...out].sort();
}

/** ③ 코드 이름 목록 — 설명 프롬프트 3종(그 버전) 용어 표 + 계약 enum. 긴 코드부터(DEFER_AFTER_FY가 CUT보다 먼저 맞게). */
export function eventCodes(version: string): string[] {
  const codes = new Set(contractEnumCodes());
  for (const k of KINDS) for (const c of glossaryCodes(readFileSync(join(REPO_ROOT, "prompts", PROMPTS[k].name, `${version}.md`), "utf8"))) codes.add(c);
  return [...codes].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** 코드 이름 정규식(ASCII 단어 경계 — "OK"가 "OKAY"·한글 사이에서도 정확히). */
export const codeRegex = (codes: readonly string[]) => new RegExp(`(?<![A-Za-z0-9_])(?:${codes.map(escape).join("|")})(?![A-Za-z0-9_])`, "g");

export function checks(codes: readonly string[]): Record<string, RegExp> {
  return {
    "① 부호 붙은 금액": /[-−]\s?[0-9][0-9,]*\s?원|마이너스/g,
    "③ 영문 알파벳": /[A-Za-z]+/g,
    "③ 코드 이름(용어 표·계약 enum)": codeRegex(codes),
    "③ 정책/계약 번호": /정책\s?번호|계약\s?번호/g,
    "③ 클로백/갱신": /클로백|갱신/g,
    "② 지급일": /지급일/g,
    "④ N차년도": /[0-9]+\s?차\s?년도/g,
    "v5 현재까지/지금": /현재까지|지금/g,
    "v5 회계연도/사업연도": /회계\s?연도|사업\s?연도/g,
    "v5 이연 시점(정해진 문장 밖)": /다음[^.]{0,15}이연|이연[^.]{0,25}(예정|[0-9]{4}년|[0-9]+월|시점|확인되지)/g,
    "v6 소리 옮김": /인센티브|클로백|리뉴얼|디퍼드|어드저스트|오프셋|커브|리베이스/g,
    "v6 현재 소진율/누적(수동 확인 — 한도의 derived는 허용)": /현재\s?(소진율|누적)/g,
  };
}

const MANUAL: Record<string, RegExp> = { 지급되었: /[^.]{0,30}지급되었[^.]{0,10}/g, 현재: /[^.]{0,20}현재[^.]{0,20}/g, 이연: /[^.]{0,30}이연[^.]{0,30}/g };

type Body = Pick<ExplanationRecord, "kind" | "agentId" | "subjectId" | "text">;
const labelOf = (r: Pick<Body, "kind" | "agentId" | "subjectId">) => `${r.kind} ${r.agentId} ${r.subjectId}`;

/** 한 본문의 항목별 적중(정해진 문장은 빼고 본다). 단건 재생성의 합격 판정에도 쓴다. */
export function hitsOf(text: string, rules: Record<string, RegExp>): Record<string, string[]> {
  const body = text.replace(FIXED_DEFER_SENTENCE, "〔정해진 문장〕");
  const out: Record<string, string[]> = {};
  for (const [k, re] of Object.entries(rules)) out[k] = [...body.matchAll(new RegExp(re.source, re.flags))].map((m) => `…${body.slice(Math.max(0, m.index - 15), m.index + m[0].length + 15)}…`);
  return out;
}

/** ③(영문·코드 이름)·①·② 적중 수 — 재생성 결과가 이것을 다시 만들면 받지 않는다. */
export const hardHits = (text: string, codes: readonly string[]) =>
  Object.entries(hitsOf(text, checks(codes)))
    .filter(([k]) => /^[①②③]/.test(k))
    .flatMap(([k, v]) => v.map((x) => `${k}: ${x}`));

export function sentenceCount(text: string): number {
  return text.split(/(?<=[.!?。])\s+/).filter((x) => x.trim()).length;
}

/** 점검 보고(문자열). rows는 그 버전 행만. */
export function report(rows: readonly ExplanationRecord[], version: string, codes: readonly string[], bodies = false): string {
  const out: string[] = [];
  const rules = checks(codes);
  const hits: Record<string, string[]> = Object.fromEntries(Object.keys(rules).map((k) => [k, []]));
  for (const r of rows) {
    if (bodies) out.push(`## ${labelOf(r)} — ${r.promptVersion} ${r.model} ${r.groundingStatus} attempts=${r.attempts}`, r.text, "");
    for (const [k, v] of Object.entries(hitsOf(r.text, rules))) for (const x of v) hits[k]!.push(`${labelOf(r)}: ${x}`);
  }
  out.push(`=== 정규식 요약(${version}, ${rows.length}건) ===`);
  for (const [k, v] of Object.entries(hits)) out.push(`${k}: ${v.length}`, ...v.map((x) => `    ${x}`));
  out.push("=== 한도 정해진 문장(결정 1) ===");
  for (const r of rows) if (r.kind === "LIMIT") out.push(`LIMIT ${r.agentId} ${r.subjectId}: ${r.text.includes(FIXED_DEFER_SENTENCE) ? "있음" : "없음"}`);
  out.push("=== 수동 확인용 구절 ===");
  for (const [k, re] of Object.entries(MANUAL)) for (const r of rows) for (const m of r.text.matchAll(new RegExp(re.source, re.flags))) out.push(`[${k}] ${labelOf(r)}: ${m[0].trim()}`);
  const sent = rows.filter((r) => r.text).map((r) => sentenceCount(r.text));
  if (sent.length) out.push(`=== 문장 수: 평균 ${(sent.reduce((a, b) => a + b, 0) / sent.length).toFixed(1)}, 최소 ${Math.min(...sent)}, 최대 ${Math.max(...sent)}, 3문장 미만 ${sent.filter((s) => s < 3).length}건`);
  out.push(`=== ③ 코드 이름 목록(${codes.length}) ===`, codes.join(" "));
  return out.join("\n");
}

/** <dir>/<hash>/*.jsonl에서 그 버전(promptVersion 끝 /vN) 행 — 종류 순서 LIMIT → LINE → MONTH_DIFF(파일 이름 순, scan_bodies.py와 같게). */
export function readVersionRows(dir: string, hash: string, version: string): ExplanationRecord[] {
  return ["limit", "line", "month_diff"].flatMap((k) => {
    let text = "";
    try {
      text = readFileSync(join(dir, hash, `${k}.jsonl`), "utf8");
    } catch {
      return [];
    }
    return text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as ExplanationRecord)
      .filter((r) => r.promptVersion.endsWith(`/${version}`));
  });
}

function main(): void {
  const args = process.argv.slice(2);
  const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const version = arg("--version") ?? PROMPTS.LINE.version;
  const hash = pickStream(arg("--stream"));
  const rows = readVersionRows(arg("--dir") ?? DATA_EXPLAIN, hash, version);
  console.log(report(rows, version, eventCodes(version), args.includes("--bodies")));
}

if (import.meta.main) main();
