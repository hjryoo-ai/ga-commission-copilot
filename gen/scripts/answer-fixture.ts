// 답변 재생 시험 픽스처(운영자 2026-11-02 — 부록 A 12건 VCR 재생): 활성 스트림의 데모 설계사 3명 행 → worker/test/fixtures/demo-stream.json.
//   node gen/scripts/answer-fixture.ts [--stream <sha256>]      (gen: pnpm run fixture:answer)
// 손으로 복사하지 않는다 — data/stream의 스트림(pickStream)·data/rulebook·contracts/sim에서 적재기와 같은 SQL(insertPlan·rulebookInserts·simStubInserts)을 만든다.
// 녹화(로컬 D1 = load:d1 --local로 넣은 같은 스트림)와 재생 시험의 툴 결과·검색 청크 본문이 같아야 요청 해시가 맞는다.
// 스트림 해시가 바뀌면 gen/test/answer-fixture.test.ts(신선도)가 실패한다 → 이 스크립트를 다시 돌린다.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { insertPlan } from "../load/flow.ts";
import { simStubInserts, simStubRows } from "../load/simStub.ts";
import { READ_MODEL, type Row, sqlValue } from "../load/sql.ts";
import { pickStream, readMeta, type StreamMeta, viewsOf } from "../load/views.ts";
import { REPO_ROOT } from "../providers/prompt.ts";
import type { Chunk } from "../rulebook/chunk.ts";
import { pickRulebook, readChunks, rulebookInserts } from "../rulebook/store.ts";
import { TENANT } from "../world/rules/tables.ts";

export const FIXTURE_PATH = join(REPO_ROOT, "worker/test/fixtures/demo-stream.json");

export interface AnswerFixture {
  generatedBy: string;
  streamHash: string;
  rulebookVersion: string;
  slot: "a";
  demoAgents: { demoNo: number; agentId: string }[];
  counts: Record<string, number>;
  /** 순서대로 실행한다(시험 D1을 비운 뒤). 마지막 문장이 stream_meta를 활성으로 바꾼다. */
  statements: string[];
}

/** 데모 설계사 행만: agent_id가 있는 표는 그 값으로, policy_limit_history는 그 설계사들의 원장(ledger_id)으로. */
export function demoViews(views: Readonly<Record<string, Row[]>>, agentIds: readonly string[]): Record<string, Row[]> {
  const agents = new Set(agentIds);
  const ledgers = new Set((views.policy_limit ?? []).filter((l) => agents.has(String(l.agent_id))).map((l) => String(l.ledger_id)));
  return Object.fromEntries(
    READ_MODEL.map((t) => [
      t,
      (views[t] ?? []).filter((r) => {
        if ("agent_id" in r) return agents.has(String(r.agent_id));
        if ("ledger_id" in r) return ledgers.has(String(r.ledger_id));
        throw new Error(`${t}: agent_id·ledger_id 없는 행 — 데모 설계사로 거를 수 없다`);
      }),
    ]),
  );
}

/** 순수 함수 — 같은 입력이면 같은 픽스처(결정론, verified_at = 스트림 generatedAt). */
export function answerFixture(hash: string, meta: StreamMeta, views: Readonly<Record<string, Row[]>>, chunks: readonly Chunk[], rulebookHash: string): AnswerFixture {
  const demo = meta.demoAgents;
  if (!demo || demo.length !== 3) throw new Error(`${hash.slice(0, 12)}: meta.demoAgents 3명 없음`);
  const sub = demoViews(
    views,
    demo.map((d) => d.agentId),
  );
  const info = { hash, generatedAt: meta.generatedAt, eventCount: meta.eventCount, planPrompt: meta.plan.prompt, demoAgents: demo };
  const lines = sub.earnings_line!.length;
  const statements = [
    ...insertPlan("a", info, sub, meta.generatedAt, TENANT),
    ...rulebookInserts(chunks),
    ...simStubInserts(simStubRows(), TENANT),
    `UPDATE stream_meta SET active = 1, line_count = ${lines} WHERE stream_hash = ${sqlValue(hash)}`,
  ];
  return {
    generatedBy: "gen/scripts/answer-fixture.ts — 손으로 고치지 않는다(pnpm run fixture:answer)",
    streamHash: hash,
    rulebookVersion: rulebookHash.slice(0, 12),
    slot: "a",
    demoAgents: demo.map((d) => ({ demoNo: d.demoNo, agentId: d.agentId })),
    counts: Object.fromEntries(READ_MODEL.map((t) => [t, sub[t]!.length])),
    statements,
  };
}

export const fixtureText = (f: AnswerFixture) => `${JSON.stringify(f, null, 1)}\n`;

/** data/에서 지금 만들면 나올 픽스처(뷰는 projection-java 리플레이 — meta의 뷰 해시와 대조). */
export function currentFixture(streamArg?: string): AnswerFixture {
  const hash = pickStream(streamArg);
  const meta = readMeta(hash);
  const rb = pickRulebook();
  return answerFixture(hash, meta, viewsOf(hash, meta), readChunks(rb), rb);
}

function main(): void {
  const args = process.argv.slice(2);
  const f = currentFixture(args.includes("--stream") ? args[args.indexOf("--stream") + 1] : undefined);
  writeFileSync(FIXTURE_PATH, fixtureText(f));
  console.log(`${FIXTURE_PATH}: stream ${f.streamHash.slice(0, 12)} · 데모 ${f.demoAgents.map((d) => `${d.demoNo}=${d.agentId}`).join(" ")} · 행 ${JSON.stringify(f.counts)} · 문장 ${f.statements.length}`);
}

if (import.meta.main) main();
