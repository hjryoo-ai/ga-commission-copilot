// data/stream/<hash>의 meta와 projection-java 리플레이 뷰(설계서 §5.1·§5.4 적재 ①). load:d1과 설명 생성(gen/explain)이 같이 쓴다.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../providers/prompt.ts";
import type { DemoAgent } from "../verify/g3.ts";
import { buildReplayCli, REPLAY_BIN } from "../verify/g2.ts";
import { READ_MODEL, type Row } from "./sql.ts";

const OUT_DIR = join(import.meta.dirname, "../out");
export const DATA_DIR = join(REPO_ROOT, "data/stream");

export interface StreamMeta {
  generatedAt: string;
  eventCount: number;
  plan: { prompt: string };
  replay: { viewsSha256: string };
  demoAgents?: DemoAgent[];
}

export function pickStream(arg: string | undefined): string {
  if (arg) return arg;
  const hashes = readdirSync(DATA_DIR).filter((f) => f.endsWith(".meta.json")).map((f) => f.slice(0, -".meta.json".length));
  if (hashes.length !== 1) throw new Error(`data/stream에 스트림이 ${hashes.length}개 — --stream <sha256>로 고른다`);
  return hashes[0]!;
}

/** ① projection-java로 뷰를 다시 만들고 meta의 뷰 해시와 대조. */
export function viewsOf(hash: string, meta: StreamMeta): Record<string, Row[]> {
  const viewsDir = join(OUT_DIR, `views-${hash.slice(0, 12)}`);
  mkdirSync(viewsDir, { recursive: true });
  const buildError = buildReplayCli();
  if (buildError) throw new Error(buildError);
  const r = spawnSync(REPLAY_BIN, ["replay", join(DATA_DIR, `${hash}.jsonl`), "--views", viewsDir], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`replay exit ${r.status}: ${r.stderr.slice(0, 1000)}`);
  const summary = JSON.parse(r.stdout.trim().split("\n").at(-1)!) as { viewsSha256: string };
  if (summary.viewsSha256 !== meta.replay.viewsSha256) throw new Error(`뷰 해시 ${summary.viewsSha256} ≠ meta ${meta.replay.viewsSha256}`);
  const out: Record<string, Row[]> = {};
  for (const t of READ_MODEL) {
    out[t] = readFileSync(join(viewsDir, `${t}.jsonl`), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Row);
  }
  return out;
}

export function readMeta(hash: string): StreamMeta {
  return JSON.parse(readFileSync(join(DATA_DIR, `${hash}.meta.json`), "utf8")) as StreamMeta;
}

