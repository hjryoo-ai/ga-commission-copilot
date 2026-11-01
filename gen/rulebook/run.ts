// 가상 사규집 생성 CLI(설계서 §4.1(c), PHASES Phase 4 항목 1).
//   node rulebook/run.ts --record [--articles 1,12]   Groq로 조항 녹화(dev 예산, 23초 간격) → 카세트 rulebook. 40조항 모두 PASS면 data/rulebook/<hash>/에 조항·청크를 쓴다.
//                                                    같은 요청 해시가 카세트에 있으면 다시 부르지 않는다(중단 뒤 이어서).
//   node rulebook/run.ts --stub                     카세트 재생 → gen/out/rulebook/<hash>/ (커밋 안 함).
//   --articles는 일부 조항만(프롬프트 확인용) — 결과는 gen/out에만 쓴다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { liveCall, newReport, RECORD_SPACING_MS, type RunReport } from "../explain/run.ts";
import type { Caller } from "../explain/generate.ts";
import { reserveDevCall } from "../providers/budget.ts";
import { openStub, replay, type VcrEntry, type VcrFile, vcrPath, writeVcr } from "../providers/cassette.ts";
import { errorsOf, SCHEMA_IDS, validator } from "../world/schemas.ts";
import { ARTICLES, type ArticlePlan } from "./articles.ts";
import { type Chunk, chunksOf, rulebookHash } from "./chunk.ts";
import { type ArticleRecord, generateArticle, labelOfArticle } from "./generate.ts";
import { DATA_RULEBOOK } from "./store.ts";

export const RULEBOOK_VCR = "rulebook";
const OUT_DIR = join(import.meta.dirname, "../out");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** --stub: 카세트 재생. */
export async function runRulebookStub(plans: readonly ArticlePlan[]): Promise<ArticleRecord[]> {
  const src = openStub(RULEBOOK_VCR);
  const call: Caller = async ({ label, hash }) => {
    const e = src.kind === "vcr" ? src.file.entries[label] : undefined;
    return { json: replay(src, label, hash), provider: "vcr", model: e?.model ?? "vcr", at: e?.recordedAt };
  };
  const out: ArticleRecord[] = [];
  for (const p of plans) out.push(await generateArticle(p, call));
  return out;
}

/** --record: Groq 실호출(dev 예산). 이번에 쓴 항목만 카세트에 남긴다(부분 녹화면 이전 항목도 남긴다). */
export async function runRulebookRecord(plans: readonly ArticlePlan[], report: RunReport, partial: boolean): Promise<ArticleRecord[]> {
  const previous: Record<string, VcrEntry> = existsSync(vcrPath(RULEBOOK_VCR)) ? (JSON.parse(readFileSync(vcrPath(RULEBOOK_VCR), "utf8")) as VcrFile).entries : {};
  const entries: Record<string, VcrEntry> = partial ? { ...previous } : {};
  let n = 0;
  const call: Caller = async ({ label, attempt, req, hash }) => {
    const prev = previous[label];
    if (prev && prev.requestHash === hash) {
      entries[label] = prev;
      writeVcr(RULEBOOK_VCR, entries);
      return { json: prev.response, provider: "groq", model: prev.model, at: prev.recordedAt };
    }
    if (n++ > 0) await sleep(RECORD_SPACING_MS);
    const r = await liveCall("groq", () => reserveDevCall(), req, report);
    const at = new Date().toISOString();
    entries[label] = { requestHash: hash, repairs: attempt, model: r.model, recordedAt: at, usage: r.usage, response: r.json };
    writeVcr(RULEBOOK_VCR, entries);
    return { json: r.json, provider: "groq", model: r.model, at };
  };
  const out: ArticleRecord[] = [];
  for (const p of plans) {
    const r = await generateArticle(p, call);
    console.log(`[record] ${labelOfArticle(p.no)} ${r.title} ${r.groundingStatus}${r.attempts === 2 ? " (재생성)" : ""}`);
    out.push(r);
  }
  return out;
}

/** 조항 레코드 → 버전·청크. 청크는 G1(contracts/rulebook/v1/chunk.schema.json). */
export function build(records: readonly ArticleRecord[]): { hash: string; version: string; chunks: Chunk[] } {
  const hash = rulebookHash(records);
  const version = hash.slice(0, 12);
  const chunks = chunksOf(records, version);
  const v = validator(SCHEMA_IDS.rulebookChunk);
  for (const c of chunks) {
    const ok: boolean = v(c);
    if (!ok) throw new Error(`${c.chunkId}: G1 ${errorsOf(v)}`);
  }
  return { hash, version, chunks };
}

export function writeRulebook(dir: string, hash: string, records: readonly ArticleRecord[], chunks: readonly Chunk[]): string {
  const d = join(dir, hash);
  mkdirSync(d, { recursive: true });
  const jsonl = (rows: readonly object[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(join(d, "articles.jsonl"), jsonl([...records].sort((a, b) => a.no - b.no)));
  writeFileSync(join(d, "chunks.jsonl"), jsonl(chunks));
  return d;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const mode = args.includes("--stub") ? "stub" : args.includes("--record") ? "record" : null;
  if (!mode) {
    console.error("usage: rulebook -- --stub|--record [--articles 1,12]");
    process.exit(2);
  }
  const only = arg("--articles")?.split(",").map(Number);
  const plans = only ? ARTICLES.filter((a) => only.includes(a.no)) : ARTICLES;
  if (only && plans.length !== only.length) throw new Error(`--articles ${only.join(",")}: 없는 조항 번호`);
  const report = newReport(`rulebook-${mode}`, "-", plans.length);
  const records = mode === "stub" ? await runRulebookStub(plans) : await runRulebookRecord(plans, report, Boolean(only));
  const fails = records.filter((r) => r.groundingStatus === "FAIL");
  const firstPass = records.filter((r) => r.attempts === 1 && r.groundingStatus === "PASS").length;
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`${mode}: 조항 ${records.length} — PASS ${records.length - fails.length} · FAIL ${fails.length}, 첫 시도 ${firstPass}/${records.length}, 호출 ${JSON.stringify(report.calls)}, 재시도 ${JSON.stringify(report.providerRetries)}`);
  for (const [k, u] of Object.entries(report.usage)) console.log(`  사용량 ${k}: 성공 ${u.ok}회 · 입력 ${u.prompt} · 출력 ${u.completion} 토큰(회당 ${u.ok ? ((u.prompt + u.completion) / u.ok).toFixed(1) : "-"})`);
  for (const f of fails) console.log(`  FAIL ${f.article}(${f.title}) ${JSON.stringify(f.failure)}`);
  writeFileSync(join(OUT_DIR, `rulebook.${mode}.report.json`), `${JSON.stringify({ ...report, articles: records.map((r) => ({ article: r.article, status: r.groundingStatus, attempts: r.attempts, failure: r.failure })) }, null, 2)}\n`);
  if (fails.length) {
    writeFileSync(join(OUT_DIR, `rulebook.${mode}.failed.jsonl`), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.error(`FAIL ${fails.length}건 — 사규집을 쓰지 않는다(gen/out/rulebook.${mode}.failed.jsonl)`);
    process.exit(1);
  }
  if (only) {
    writeFileSync(join(OUT_DIR, `rulebook.${mode}.partial.jsonl`), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.log(`일부 조항(${only.join(",")}) — gen/out/rulebook.${mode}.partial.jsonl`);
    return;
  }
  const { hash, version, chunks } = build(records);
  const dir = writeRulebook(mode === "record" ? DATA_RULEBOOK : join(OUT_DIR, "rulebook"), hash, records, chunks);
  const byVis = (v: string) => chunks.filter((c) => c.visibility === v).length;
  const toks = chunks.map((c) => c.tokenCount);
  console.log(`rulebook ${version}: 조항 ${records.length}, 청크 ${chunks.length}(agent ${byVis("agent")} · internal ${byVis("internal")}), 토큰 합 ${toks.reduce((a, b) => a + b, 0)} · 최소 ${Math.min(...toks)} · 최대 ${Math.max(...toks)} · 300 미만 ${toks.filter((t) => t < 300).length} → ${dir}`);
}

if (import.meta.main) await main();
