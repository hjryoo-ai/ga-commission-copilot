// 답 프롬프트 토큰 오프라인 측정(운영자 2026-11-18 — 60문항 전체, LLM·원격 호출 없음, 로컬 D1만).
//   pnpm --dir evals run tokens -- [--prompt-versions answer=v5] [--k 6,4,2] [--json out.json]
// 각 케이스(normal 60 + rulesUnavailable 4)에서 기준선 카세트(evals/vcr/eval.json — answer/v3 녹화)의 1단계 요청에서 규정 청크 id와
// 1단계 응답의 툴 호출을 꺼내, 지금 코드의 툴(tool_results는 그 프롬프트 frontmatter)과 그 프롬프트로 1·2단계 본문을 다시 만들어 센다.
// 입력 = o200k(본문) + 고정분(응답 스키마·채팅 틀 — contracts/answer/v1 584, v2 559: 2026-11-13 기준선 카세트·2026-11-18 로컬 재현 llm_trace 실측).
// 출력 토큰은 녹화값(v3)이다 — 질문 합 = 1단계 입력 + 1단계 출력 + 2단계 입력 + 2단계 출력.
// 2단계 입력은 서버의 합계 예산(answer.ts fitStage2) 적용 전·후를 함께 낸다. --k는 2단계 규정 청크 수 비교(앞에서 k개).
// 서버와 같게 2단계에도 session을 넘긴다(v4·v5는 2단계 구역에 <session>이 없어 빠지고, 구역이 없는 v1~v3은 들어간다).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encode } from "gpt-tokenizer/encoding/o200k_base";
import { activeStream, DEMO_TENANT, rulebookChunks, ScopedQuery } from "../../worker/src/db/ScopedQuery";
import { dataBlock, fitStage2, QUESTION_MAX_TOKENS, rulesBlock, sessionBlock, STAGE2_OUTPUT_RESERVE } from "../../worker/src/llm/answer";
import { activePrompt, render } from "../../worker/src/llm/promptRegistry";
import { InvalidToolCall, parseToolCall, rejectedResult, runTool, type ToolResult } from "../../worker/src/tools";
import { approxTokens, estimateTokens } from "../../worker/src/tools/result";
import type { EvalCase } from "../src/score";

const ROOT = join(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const arg = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const PV = arg("--prompt-versions") ?? "answer=v5";
const KS = (arg("--k") ?? "6,4,2").split(",").map(Number);
// --calls-from <runs.jsonl>: 그 런에 있는 케이스는 1단계 툴 호출과 출력 토큰을 그 런 값으로(예 PR #10 v4 런 — G-18 get_statement 202705·202805)
const callsFrom = arg("--calls-from");
type RunLine = { caseId: string; mode: string; toolCalls?: { tool: string; args: Record<string, string> }[]; usage?: { promptTokens: number | null; completionTokens: number | null }[] };
const override = new Map<string, RunLine>(
  callsFrom ? readFileSync(callsFrom, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as RunLine).filter((x) => x.toolCalls?.length).map((x) => [x.mode === "normal" ? x.caseId : `${x.caseId}#RU`, x]) : [],
);
const OVERHEAD: Record<string, number> = { "contracts/answer/v1/answer.schema.json": 584, "contracts/answer/v2/answer.schema.json": 559 };
const CALL_MAX = 3600;

type Entry = { request: { messages: { content: string }[] }; response: { json: { refused?: boolean; toolCalls?: { tool: string; args: Record<string, string | null> }[] }; usage?: { prompt_tokens: number; completion_tokens: number } } };
const cassette = JSON.parse(readFileSync(join(ROOT, "evals/vcr/eval.json"), "utf8")) as { entries: Record<string, Entry> };
const entries = Object.values(cassette.entries);
const cases = readFileSync(join(ROOT, "evals/cases.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as EvalCase);
const tok = (s: string) => encode(s).length;

interface Row {
  key: string;
  s1: number;
  s1Out: number | null;
  tools: string[];
  s2Before: number | null;
  s2After: number | null;
  s2Out: number | null;
  totalBefore: number | null;
  totalAfter: number | null;
  shrunk: string[];
  byK: Record<number, number | null>;
  dataReal: number | null;
  dataApprox: number | null;
  fixedReal: number | null;
  fixedApprox: number | null;
  dataEst: number | null;
  fixedEst: number | null;
  /** 추정 계수 맞추기용 — [ASCII 글자 수, 그 밖 글자 수, o200k] */
  fixedChars: [number, number, number] | null;
  dataChars: [number, number, number] | null;
  from: string;
  /** 카세트에 녹화된 prompt_tokens(같은 프롬프트로 잴 때 재구성 검증용 — answer/v3). */
  rec1: number | null;
  rec2: number | null;
}

const { getPlatformProxy } = await import("wrangler");
const proxy = await getPlatformProxy<Env>({ configPath: join(ROOT, "worker/wrangler.jsonc"), environment: "record", envFiles: [], persist: { path: join(ROOT, "worker/.wrangler/state/v3") }, remoteBindings: false });
const env = proxy.env;
const rows: Row[] = [];
/** 기준선에서 응답이 없던 케이스(오류 — G-35 Workers AI 타임아웃)는 1단계 녹화가 없어 뺀다. */
const skipped: string[] = [];
try {
  const stream = await activeStream(env.DB);
  if (!stream) throw new Error("활성 스트림 없음(로컬 D1 — load:d1 --local)");
  const p = activePrompt({ PROMPT_VERSIONS: PV }, "answer");
  const overhead = OVERHEAD[(p as unknown as { outputSchemaPath?: string }).outputSchemaPath ?? ""] ?? (p.toolResults === "v2" ? 559 : 584);
  for (const c of cases)
    for (const mode of c.modes) {
      const ru = mode === "rulesUnavailable";
      const content = (e: Entry) => e.request.messages.at(-1)!.content;
      const mine = entries.filter((e) => content(e).includes(`<question>\n${c.question}\n</question>`) && /^<rules>\n\[chunkId/m.test(content(e)) !== ru);
      const e1 = mine.find((e) => content(e).includes("단계: 1단계"));
      const e2 = mine.find((e) => content(e).includes("단계: 2단계"));
      if (!e1) {
        skipped.push(`${c.id}${ru ? "#RU" : ""}`);
        continue;
      }
      const chunkIds = [...content(e1).matchAll(/\[chunkId ([^\]]+)\]/g)].map((m) => m[1]!);
      const chunkRows = chunkIds.length ? await rulebookChunks(env.DB, chunkIds) : [];
      const ordered = chunkIds.map((id) => chunkRows.find((r) => r.chunk_id === id)!).filter(Boolean);
      const q = new ScopedQuery(env.DB, { tenantId: DEMO_TENANT, agentId: c.agentId, stream });
      const session = p.body.includes("{{session}}") ? await sessionBlock(q, p.body.includes("한도 삭감이 있었던 계약")) : "";
      const s1Text = render(p.body, { stage: "1단계", stage1: "1", stage2: "", session, rules: rulesBlock(ordered), data: "", question: c.question });
      const s1 = tok(s1Text) + overhead;
      const key = ru ? `${c.id}#RU` : c.id;
      const ov = override.get(key);
      const s1Out = ov ? (ov.usage?.[0]?.completionTokens ?? null) : (e1.response.usage?.completion_tokens ?? null);
      const out = ov ? { refused: false, toolCalls: ov.toolCalls } : e1.response.json;
      const s2Out = ov ? (ov.usage?.[1]?.completionTokens ?? null) : (e2?.response.usage?.completion_tokens ?? null);
      const row: Row = { key, s1, s1Out, tools: [], s2Before: null, s2After: null, s2Out, totalBefore: null, totalAfter: null, shrunk: [], byK: {}, dataReal: null, dataApprox: null, fixedReal: null, fixedApprox: null, dataEst: null, fixedEst: null, fixedChars: null, dataChars: null, rec1: e1.response.usage?.prompt_tokens ?? null, rec2: e2?.response.usage?.prompt_tokens ?? null, from: ov ? "calls-from" : "baseline" };
      if (!out.refused && out.toolCalls?.length) {
        const results: ToolResult[] = [];
        for (const raw of out.toolCalls.slice(0, 3)) {
          const a = Object.fromEntries(Object.entries(raw.args ?? {}).filter(([, v]) => v !== null)) as Record<string, string>;
          try {
            results.push(await runTool({ q, version: p.toolResults }, parseToolCall({ tool: raw.tool, args: a })));
          } catch (err) {
            if (!(err instanceof InvalidToolCall)) throw err;
            if (p.toolResults === "v2") results.push(await rejectedResult(q, { tool: raw.tool, args: a }, err.message));
          }
          row.tools.push(`${raw.tool}(${Object.values(a).join(",")})`);
        }
        const s2 = (rs: readonly ToolResult[], k = ordered.length) => render(p.body, { stage: "2단계", stage1: "", stage2: "1", session, rules: rulesBlock(ordered.slice(0, k)), data: dataBlock(rs), question: c.question });
        row.s2Before = tok(s2(results)) + overhead;
        const fixed = s2([]);
        row.fixedReal = tok(fixed) + overhead;
        row.fixedApprox = approxTokens(fixed) + overhead;
        row.dataReal = tok(dataBlock(results));
        row.dataApprox = approxTokens(dataBlock(results));
        row.fixedEst = estimateTokens(fixed) + overhead;
        row.dataEst = estimateTokens(dataBlock(results));
        const chars = (x: string): [number, number, number] => {
          let a = 0;
          for (const ch of x) if (ch.charCodeAt(0) < 128) a++;
          return [a, [...x].length - a, tok(x)];
        };
        row.fixedChars = chars(fixed);
        row.dataChars = chars(dataBlock(results));
        // 서버 합계 예산(fitStage2)을 녹화한 1단계 입·출력으로 — 운영에서는 1단계 응답 usage 실측값
        // 서버는 툴 결과 v2 프롬프트에만 적용한다(answer.ts) — 측정은 v1이어도 "적용하면"을 보여 준다
        const fitted = await fitStage2({ q, version: p.toolResults }, results, { fixedText: fixed, overhead, stage1Tokens: s1 + (s1Out ?? 0) });
        row.shrunk = fitted.shrunk;
        row.s2After = tok(s2(fitted.results)) + overhead;
        for (const k of KS) row.byK[k] = tok(s2(fitted.results, k)) + overhead;
        row.totalBefore = s1 + (s1Out ?? 0) + row.s2Before + (row.s2Out ?? 0);
        row.totalAfter = s1 + (s1Out ?? 0) + row.s2After + (row.s2Out ?? 0);
      } else row.totalBefore = row.totalAfter = s1 + (s1Out ?? 0);
      rows.push(row);
    }
} finally {
  await proxy.dispose();
}

const max = (xs: (number | null)[]) => Math.max(...xs.filter((x): x is number => x !== null));
const min = (xs: (number | null)[]) => Math.min(...xs.filter((x): x is number => x !== null));
console.log(`# 답 프롬프트 토큰(${PV}, 60문항 + rulesUnavailable 4, 상한 호출당 입력 ${CALL_MAX} · 질문당 ${QUESTION_MAX_TOKENS}, 2단계 출력 몫 ${STAGE2_OUTPUT_RESERVE})`);
console.log("| 케이스 | 1단계 입력 | 1단계 출력(녹화) | 툴 | 2단계 입력 전 → 후 | 2단계 출력(녹화) | 질문 합 전 → 후 | 줄인 결과 | 2단계 규정 k개 |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  const flag = (n: number | null, cap: number) => (n === null ? "—" : n > cap ? `**${n}**` : String(n));
  console.log(`| ${r.key}${r.from === "calls-from" ? "*" : ""} | ${flag(r.s1, CALL_MAX)} | ${r.s1Out ?? "—"} | ${r.tools.join(" ") || "—"} | ${r.s2Before === null ? "—" : `${flag(r.s2Before, CALL_MAX)} → ${flag(r.s2After, CALL_MAX)}`} | ${r.s2Out ?? "—"} | ${flag(r.totalBefore, QUESTION_MAX_TOKENS)} → ${flag(r.totalAfter, QUESTION_MAX_TOKENS)} | ${r.shrunk.join(" ") || "—"} | ${KS.map((k) => `${k}:${r.byK[k] ?? "—"}`).join(" ")} |`);
}
const s2 = rows.filter((r) => r.s2Before !== null && (r.dataReal ?? 0) > 0);
const rec = rows.filter((r) => r.from === "baseline" && r.rec1 !== null);
if (PV.includes("answer=v3")) {
  const bad1 = rec.filter((r) => r.rec1 !== r.s1).map((r) => `${r.key} ${r.rec1}≠${r.s1}`);
  const bad2 = rec.filter((r) => r.rec2 !== null && r.s2Before !== null && r.rec2 !== r.s2Before).map((r) => `${r.key} ${r.rec2}≠${r.s2Before}`);
  console.log(`\n- 재구성 검증(answer/v3 — 카세트 prompt_tokens와 같아야 한다): 1단계 ${rec.length - bad1.length}/${rec.length} 일치${bad1.length ? ` · 다름 ${bad1.join(" ")}` : ""}, 2단계 다름 ${bad2.join(" ") || "없음"}`);
}
console.log(`\n- 측정 ${rows.length}건(뺀 것: ${skipped.join(" ") || "없음"} — 기준선 녹화 없음)`);
console.log(`- 1단계 입력 ${min(rows.map((r) => r.s1))}–${max(rows.map((r) => r.s1))} · 3,600 넘는 건 ${rows.filter((r) => r.s1 > CALL_MAX).map((r) => r.key).join(" ") || "없음"}`);
console.log(`- 2단계 입력(전) ${min(s2.map((r) => r.s2Before))}–${max(s2.map((r) => r.s2Before))} · 3,600 넘는 건 ${s2.filter((r) => r.s2Before! > CALL_MAX).map((r) => `${r.key} ${r.s2Before}`).join(" ") || "없음"}`);
console.log(`- 2단계 입력(후) ${min(s2.map((r) => r.s2After))}–${max(s2.map((r) => r.s2After))} · 3,600 넘는 건 ${s2.filter((r) => r.s2After! > CALL_MAX).map((r) => `${r.key} ${r.s2After}`).join(" ") || "없음"}`);
console.log(`- 질문 합(전) 최대 ${max(rows.map((r) => r.totalBefore))} · 7,500 넘는 건 ${rows.filter((r) => r.totalBefore! > QUESTION_MAX_TOKENS).map((r) => `${r.key} ${r.totalBefore}`).join(" ") || "없음"}`);
console.log(`- 질문 합(후) 최대 ${max(rows.map((r) => r.totalAfter))} · 7,500 넘는 건 ${rows.filter((r) => r.totalAfter! > QUESTION_MAX_TOKENS).map((r) => `${r.key} ${r.totalAfter}`).join(" ") || "없음"}`);
for (const k of KS) console.log(`- 2단계 규정 ${k}개: 2단계 입력 최대 ${max(s2.map((r) => r.byK[k] ?? null))}`);
console.log(`- 추정 대 실측(fitStage2의 estimateTokens ÷ o200k — 1 이상이어야 넘치지 않는다): 툴 결과 ${min(s2.map((r) => r.dataEst! / r.dataReal!)).toFixed(2)}–${max(s2.map((r) => r.dataEst! / r.dataReal!)).toFixed(2)} · 고정분 ${min(s2.map((r) => r.fixedEst! / r.fixedReal!)).toFixed(2)}–${max(s2.map((r) => r.fixedEst! / r.fixedReal!)).toFixed(2)}${callsFrom ? ` · * = 툴 호출·출력 토큰을 ${callsFrom.split("/").slice(-2).join("/")}에서` : ""}`);
console.log(`- 참고(결과당 1,200 규칙의 approxTokens ÷ o200k): 툴 결과 ${min(s2.map((r) => r.dataApprox! / r.dataReal!)).toFixed(2)}–${max(s2.map((r) => r.dataApprox! / r.dataReal!)).toFixed(2)} · 고정분(프롬프트·규정·질문) ${min(s2.map((r) => r.fixedApprox! / r.fixedReal!)).toFixed(2)}–${max(s2.map((r) => r.fixedApprox! / r.fixedReal!)).toFixed(2)}`);
const json = arg("--json");
if (json) writeFileSync(json, `${JSON.stringify(rows, null, 1)}\n`);
