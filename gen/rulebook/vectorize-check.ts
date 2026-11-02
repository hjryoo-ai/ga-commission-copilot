// 원격 Vectorize 필터 점검(운영자 2026-11-02 — 항목 6 Vectorize 시험 방식 (b), PHASES Phase 4 항목 6 완료 기준 "internal 청크가 어떤 질의에도 반환되지 않음"의 증거).
//   node rulebook/vectorize-check.ts [--rulebook <hash>]
// Miniflare에 Vectorize 로컬 시뮬레이션이 없어(원격 프록시만) 단위 시험은 D1 재필터만 본다 — 이 스크립트가 실제 인덱스의 메타데이터 필터를 본다.
// internal 청크마다 자기 벡터로(--vector-id) 두 번 질의한다 — internal에 가장 가까운 질의라 필터가 새면 여기서 먼저 보인다:
//   ① 필터 없음 top-k 5     → 1위가 자기 자신(internal 벡터가 인덱스에 있고 검색된다는 대조군)
//   ② visibility=agent top-k 20 → internal 0건, 20건 모두 agent(런타임 answer.ts와 같은 필터)
// Workers AI는 부르지 않는다(임베딩 없음). 질의 6회 × (1 + 저장 40) × 1024차원 ≈ 25만 질의 차원(무료 월 3,000만).
import { pickRulebook, readChunks } from "./store.ts";
import { VECTORIZE_INDEX, wrangler } from "./embed.ts";

export const AGENT_FILTER = { visibility: "agent" } as const;
const TOP_K_UNFILTERED = 5;
const TOP_K_FILTERED = 20;

export interface Match {
  id: string;
  score: number;
  visibility: string;
}

export interface Probe {
  queryId: string;
  unfiltered: Match[];
  filtered: Match[];
}

/** 판정: 대조군(①의 1위가 자기 자신·internal)과 필터(② internal 0건·결과 수가 top-k). */
export function judge(probes: readonly Probe[], internalIds: ReadonlySet<string>, topK = TOP_K_FILTERED): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = probes.length > 0 && probes.length === internalIds.size;
  if (!ok) lines.push(`✗ 질의 ${probes.length}개 ≠ internal 청크 ${internalIds.size}개`);
  const fmt = (ms: readonly Match[]) => ms.map((m) => `${m.id}(${m.score.toFixed(4)}, ${m.visibility})`).join(" · ");
  for (const p of probes) {
    const self = p.unfiltered[0]?.id === p.queryId && p.unfiltered[0]?.visibility === "internal";
    const leaked = p.filtered.filter((m) => internalIds.has(m.id) || m.visibility !== "agent");
    const full = p.filtered.length === topK;
    ok &&= self && leaked.length === 0 && full;
    lines.push(`== ${p.queryId}(internal) 자기 벡터로 질의`);
    lines.push(`  ① 필터 없음 top-k ${p.unfiltered.length}: ${self ? "✓ 1위 = 자기 자신(internal)" : "✗ 1위가 자기 자신 아님"} — internal ${p.unfiltered.filter((m) => m.visibility === "internal").length}건`);
    lines.push(`     ${fmt(p.unfiltered)}`);
    lines.push(`  ② visibility=agent top-k ${p.filtered.length}: ${leaked.length === 0 ? "✓ internal 0건" : `✗ internal ${leaked.length}건 ${leaked.map((m) => m.id).join(",")}`}${full ? "" : ` ✗ 결과 ${p.filtered.length} < ${topK}`}`);
    lines.push(`     ${fmt(p.filtered.slice(0, 5))}${p.filtered.length > 5 ? ` … (+${p.filtered.length - 5})` : ""}`);
  }
  lines.push(ok ? `판정: 통과 — internal ${internalIds.size}개 모두 필터 없이 1위, visibility=agent 필터로 0건` : "판정: 실패");
  return { ok, lines };
}

/** wrangler vectorize query 출력(머리글 뒤 JSON) → Match[]. */
export function parseQuery(stdout: string): Match[] {
  const j = JSON.parse(stdout.slice(stdout.indexOf("{"))) as { matches: { id: string; score: number; metadata?: { visibility?: string } }[] };
  return j.matches.map((m) => ({ id: m.id, score: m.score, visibility: m.metadata?.visibility ?? "?" }));
}

function query(id: string, topK: number, filter?: object): Match[] {
  return parseQuery(wrangler(["vectorize", "query", VECTORIZE_INDEX, "--vector-id", id, "--top-k", String(topK), "--return-metadata", "indexed", ...(filter ? ["--filter", JSON.stringify(filter)] : [])]));
}

function main(): void {
  const args = process.argv.slice(2);
  const hash = pickRulebook(args.includes("--rulebook") ? args[args.indexOf("--rulebook") + 1] : undefined);
  const chunks = readChunks(hash);
  const internal = chunks.filter((c) => c.visibility === "internal");
  console.log(`rulebook ${hash.slice(0, 12)} — 청크 ${chunks.length}(agent ${chunks.length - internal.length} · internal ${internal.length}), 인덱스 ${VECTORIZE_INDEX}, ${new Date().toISOString()}`);
  const probes = internal.map((c) => ({ queryId: c.chunkId, unfiltered: query(c.chunkId, TOP_K_UNFILTERED), filtered: query(c.chunkId, TOP_K_FILTERED, AGENT_FILTER) }));
  const r = judge(probes, new Set(internal.map((c) => c.chunkId)));
  for (const l of r.lines) console.log(l);
  if (!r.ok) process.exit(1);
}

if (import.meta.main) main();
