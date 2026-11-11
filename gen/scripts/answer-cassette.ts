// 답변 카세트 추출(운영자 2026-11-01 — 답변 VCR 방식): 로컬 D1 llm_trace → worker/test/vcr/answer.json.
//   녹화: worker/.dev.vars에 LLM_TRACE=1(+ GROQ_API_KEY) → `cd worker && pnpm exec wrangler dev --local` → 부록 A 12건을 POST /api/v1/me/ask
//   추출: `node gen/scripts/answer-cassette.ts [--since <ISO 시각>] [--out <저장소 상대 경로>]` — 같은 요청 해시가 여럿이면 가장 늦은 것.
// 시험(worker/test/vcr.ts)은 이 파일을 묶어 가짜 공급자로 재생한다(요청 해시 = providers.ts requestHash).
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../providers/prompt.ts";

interface TraceRow {
  request_hash: string;
  provider: string;
  model: string;
  request: string;
  response: string;
  created_at: string;
}

export interface AnswerCassette {
  kind: "vcr";
  name: "answer";
  entries: Record<string, { provider: string; model: string; recordedAt: string; request: unknown; response: { json: unknown; model: string; usage: unknown } }>;
}

export function cassetteOf(rows: readonly TraceRow[]): AnswerCassette {
  const entries: AnswerCassette["entries"] = {};
  for (const r of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    entries[r.request_hash] = { provider: r.provider, model: r.model, recordedAt: r.created_at, request: JSON.parse(r.request), response: JSON.parse(r.response) as AnswerCassette["entries"][string]["response"] };
  }
  return { kind: "vcr", name: "answer", entries: Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) };
}

function main(): void {
  const args = process.argv.slice(2);
  const since = args.includes("--since") ? args[args.indexOf("--since") + 1]! : "";
  if (since && !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(since)) throw new Error(`--since ${since}: ISO UTC 시각 아님`);
  const sql = `SELECT request_hash, provider, model, request, response, created_at FROM llm_trace${since ? ` WHERE created_at >= '${since}'` : ""} ORDER BY created_at`;
  const r = spawnSync("pnpm", ["--dir", join(REPO_ROOT, "worker"), "exec", "wrangler", "d1", "execute", "copilot", "--local", "--json", "--command", sql], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`wrangler d1 execute --local 실패: ${(r.stderr || r.stdout).slice(0, 1000)}`);
  const rows = (JSON.parse(r.stdout.slice(r.stdout.search(/^\[/m))) as { results: TraceRow[] }[]).at(-1)!.results;
  const cassette = cassetteOf(rows);
  // --out: 평가 하네스 카세트(evals/vcr/eval.json — PHASES Phase 6 항목 2 --stub)처럼 다른 곳으로
  const file = args.includes("--out") ? join(REPO_ROOT, args[args.indexOf("--out") + 1]!) : join(REPO_ROOT, "worker/test/vcr/answer.json");
  writeFileSync(file, `${JSON.stringify(cassette, null, 1)}\n`);
  console.log(`llm_trace ${rows.length}행 → 카세트 ${Object.keys(cassette.entries).length}항목 → ${file}`);
}

if (import.meta.main) main();
