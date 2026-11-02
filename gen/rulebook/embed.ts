// 사규집 청크 임베딩·Vectorize 업서트(설계서 §4.1(c)·§5.2, PHASES Phase 4 항목 1).
//   node rulebook/embed.ts [--rulebook <hash>]            bge-m3(Workers AI REST)로 청크 임베딩 → gen/out/rulebook/<hash>/vectors.ndjson(커밋 안 함 — 다시 만들 수 있다)
//   node rulebook/embed.ts [--rulebook <hash>] --upsert   + visibility 메타데이터 인덱스(없으면 만든다) → wrangler vectorize upsert rulebook-v1
// 임베딩 호출은 dev 예산(budget_counter scope=dev)에 센다. 키는 gen/.dev.vars의 CLOUDFLARE_API_TOKEN·CLOUDFLARE_ACCOUNT_ID(규약 10 — 값은 출력하지 않는다).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reserveDevCall } from "../providers/budget.ts";
import { loadEnv } from "../providers/env.ts";
import { REPO_ROOT } from "../providers/prompt.ts";
import type { Chunk } from "./chunk.ts";
import { pickRulebook, readChunks } from "./store.ts";

export const EMBED_MODEL = "@cf/baai/bge-m3";
export const EMBED_DIMENSIONS = 1024;
export const VECTORIZE_INDEX = "rulebook-v1";
/** Workers AI 텍스트 임베딩 한 요청의 입력 수 상한보다 작게. */
const BATCH = 50;

export interface VectorRecord {
  id: string;
  values: number[];
  metadata: { article: string; visibility: string; version: string; chunk_id: string };
}

/** 임베딩 입력 = 청크 본문(조항 머리 포함). 런타임 질의도 같은 모델로 임베딩한다. */
export function vectorOf(c: Chunk, values: readonly number[]): VectorRecord {
  if (values.length !== EMBED_DIMENSIONS) throw new Error(`${c.chunkId}: 차원 ${values.length} ≠ ${EMBED_DIMENSIONS}`);
  return { id: c.chunkId, values: [...values], metadata: { article: c.article, visibility: c.visibility, version: c.version, chunk_id: c.chunkId } };
}

async function embedBatch(texts: readonly string[]): Promise<number[][]> {
  const key = loadEnv("CLOUDFLARE_API_TOKEN");
  const account = loadEnv("CLOUDFLARE_ACCOUNT_ID");
  if (!key || !account) throw new Error("CLOUDFLARE_API_TOKEN·CLOUDFLARE_ACCOUNT_ID가 gen/.dev.vars 또는 환경에 없다");
  reserveDevCall();
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${EMBED_MODEL}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ text: texts }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await res.json()) as { success?: boolean; result?: { data?: number[][]; shape?: number[] }; errors?: unknown };
  if (!res.ok || !body.success || !body.result?.data) throw new Error(`Workers AI ${EMBED_MODEL} HTTP ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 500)}`);
  if (body.result.data.length !== texts.length) throw new Error(`임베딩 ${body.result.data.length}개 ≠ 입력 ${texts.length}개`);
  return body.result.data;
}

export function wrangler(args: string[]): string {
  const r = spawnSync("pnpm", ["--dir", join(REPO_ROOT, "worker"), "exec", "wrangler", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`wrangler ${args.slice(0, 3).join(" ")} 실패(exit ${r.status}): ${(r.stderr || r.stdout).trim().slice(0, 1500)}`);
  return r.stdout;
}

/** visibility 메타데이터 인덱스(§5.2) — 필터 질의는 인덱스가 생긴 뒤 넣은 벡터에만 먹으므로 업서트 전에 만든다. */
function ensureMetadataIndex(): void {
  const list = wrangler(["vectorize", "list-metadata-index", VECTORIZE_INDEX]);
  if (/\bvisibility\b/.test(list)) {
    console.log(`metadata index visibility: 있음`);
    return;
  }
  wrangler(["vectorize", "create-metadata-index", VECTORIZE_INDEX, "--propertyName=visibility", "--type=string"]);
  console.log(`metadata index visibility: 만듦`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const hash = pickRulebook(arg("--rulebook"));
  const chunks = readChunks(hash);
  const outDir = join(import.meta.dirname, "../out/rulebook", hash);
  const file = join(outDir, "vectors.ndjson");
  let vectors: VectorRecord[];
  if (existsSync(file) && !args.includes("--force")) {
    vectors = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as VectorRecord);
    if (vectors.map((v) => v.id).join() !== chunks.map((c) => c.chunkId).join()) throw new Error(`${file}: 청크와 다르다 — --force로 다시 임베딩`);
    console.log(`임베딩 재사용 ${vectors.length}개(${file})`);
  } else {
    vectors = [];
    for (let i = 0; i < chunks.length; i += BATCH) {
      const part = chunks.slice(i, i + BATCH);
      const data = await embedBatch(part.map((c) => c.body));
      part.forEach((c, j) => vectors.push(vectorOf(c, data[j]!)));
    }
    mkdirSync(outDir, { recursive: true });
    writeFileSync(file, vectors.map((v) => JSON.stringify(v)).join("\n") + "\n");
    console.log(`임베딩 ${vectors.length}개 · 호출 ${Math.ceil(chunks.length / BATCH)}회(dev 예산) · 토큰 합 ${chunks.reduce((a, c) => a + c.tokenCount, 0)}(o200k 기준) → ${file}`);
  }
  if (!args.includes("--upsert")) return;
  ensureMetadataIndex();
  const out = wrangler(["vectorize", "upsert", VECTORIZE_INDEX, "--file", file]);
  console.log(out.trim().split("\n").filter((l) => !/^\s*$|wrangler \d|─/.test(l)).join("\n"));
}

if (import.meta.main) await main();
