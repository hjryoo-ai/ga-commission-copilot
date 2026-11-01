// data/rulebook/<hash>/{articles,chunks}.jsonl 읽기와 rulebook_chunk 적재 SQL(설계서 §4.1(c)·§5.1). 순수 함수 + 파일 읽기만 — 실행은 load/d1.ts.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../providers/prompt.ts";
import { MAX_STATEMENT_BYTES, sqlValue } from "../load/sql.ts";
import { errorsOf, SCHEMA_IDS, validator } from "../world/schemas.ts";
import type { Chunk } from "./chunk.ts";

export const DATA_RULEBOOK = join(REPO_ROOT, "data/rulebook");

/** --rulebook <hash>가 없으면 data/rulebook의 유일한 디렉터리. 둘 이상이면 고르게 한다. */
export function pickRulebook(hash?: string): string {
  if (hash) {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`rulebook ${hash}: SHA-256 아님`);
    if (!existsSync(join(DATA_RULEBOOK, hash))) throw new Error(`data/rulebook/${hash} 없음`);
    return hash;
  }
  const dirs = existsSync(DATA_RULEBOOK) ? readdirSync(DATA_RULEBOOK).filter((d) => /^[0-9a-f]{64}$/.test(d)) : [];
  if (dirs.length !== 1) throw new Error(`data/rulebook에 사규집이 ${dirs.length}개 — --rulebook <hash>로 고른다`);
  return dirs[0]!;
}

/** chunks.jsonl을 읽고 G1(chunk.schema.json)·버전 일치를 확인한다. */
export function readChunks(hash: string): Chunk[] {
  const v = validator(SCHEMA_IDS.rulebookChunk);
  const chunks = readFileSync(join(DATA_RULEBOOK, hash, "chunks.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Chunk);
  for (const c of chunks) {
    const ok: boolean = v(c);
    if (!ok) throw new Error(`${c.chunkId}: G1 ${errorsOf(v)}`);
    if (c.version !== hash.slice(0, 12)) throw new Error(`${c.chunkId}: 버전 ${c.version} ≠ ${hash.slice(0, 12)}`);
  }
  return chunks;
}

/** rulebook_chunk INSERT OR IGNORE(같은 chunk_id는 같은 본문 — 버전이 id에 있다). 테넌트 없는 공용 표(§5.1 DDL). */
export function rulebookInserts(chunks: readonly Chunk[]): string[] {
  const head = "INSERT OR IGNORE INTO rulebook_chunk (chunk_id, article, title, body, visibility, version, token_count) VALUES\n";
  const out: string[] = [];
  let tuples: string[] = [];
  let bytes = Buffer.byteLength(head);
  for (const c of chunks) {
    const t = `(${[c.chunkId, c.article, c.title, c.body, c.visibility, c.version, c.tokenCount].map(sqlValue).join(", ")})`;
    const b = Buffer.byteLength(t) + 2;
    if (tuples.length && bytes + b > MAX_STATEMENT_BYTES) {
      out.push(head + tuples.join(",\n"));
      tuples = [];
      bytes = Buffer.byteLength(head);
    }
    tuples.push(t);
    bytes += b;
  }
  if (tuples.length) out.push(head + tuples.join(",\n"));
  return out;
}
