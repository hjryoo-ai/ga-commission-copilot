// 수기 픽스처 작성기(설계서 v0.1.3 §12 Phase 1 VCR 규칙). LLM 출력이 아니다 — VCR 녹화 전 --stub 폴백 전용.
// 결정론 의사난수로 설계사별 계약을 만들고 plan-check 규칙을 통과하는지 확인한 뒤 gen/providers/fixtures/plan.fixture.json에 쓴다.
//   node scripts/make-plan-fixture.ts
import { writeFileSync } from "node:fs";
import type { FixtureFile } from "../providers/cassette.ts";
import { fixturePath } from "../providers/cassette.ts";
import { AGENT_CONSTRAINTS, AGENTS, type Agent } from "../world/agents.ts";
import { addDays, addMonths, monthsBetween, ymOf } from "../world/calendar.ts";
import type { LlmContract, LlmPlanChunk } from "../world/plan-types.ts";
import { chunkProblems } from "../world/plan.ts";
import { CONTRACT_FROM, CONTRACT_TO, HORIZON_YM, PRODUCTS } from "../world/rules/tables.ts";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function fixtureChunk(a: Agent): LlmPlanChunk {
  const r = rng(a.no * 7919);
  const k = AGENT_CONSTRAINTS[a.agentId] ?? {};
  const start = k.contractFrom ?? CONTRACT_FROM;
  const span = dayDiff(start, CONTRACT_TO);
  const contracts: LlmContract[] = [];
  for (let i = 0; i < a.llmContracts; i++) {
    let date = addDays(start, Math.floor(((i + r()) * span) / a.llmContracts));
    while (k.excludeMonths?.includes(ymOf(date))) date = addDays(date, 31);
    if (date > CONTRACT_TO) date = addDays(start, i);
    const prod = PRODUCTS[Math.floor(r() * PRODUCTS.length)]!;
    const steps = (prod.premiumMax - prod.premiumMin) / 1000 + 1;
    const premium = prod.premiumMin + Math.floor(r() * steps) * 1000;
    const lifecycle: LlmContract["lifecycle"] = [];
    const startYm = ymOf(date);
    const room = monthsBetween(startYm, HORIZON_YM);
    const x = r();
    if (!k.noLifecycle && room >= 3) {
      if (x < 0.07) lifecycle.push({ ym: addMonths(startYm, 1 + Math.floor(r() * Math.min(18, room - 1))), event: "CANCEL" });
      else if (x < 0.1) lifecycle.push({ ym: addMonths(startYm, 2 + Math.floor(r() * Math.min(9, room - 2))), event: "REDUCE" });
      else if (x < 0.12) {
        const lapse = addMonths(startYm, 2 + Math.floor(r() * Math.min(10, room - 2)));
        lifecycle.push({ ym: lapse, event: "LAPSE" });
        const back = addMonths(lapse, 2);
        if (r() < 0.5 && back <= HORIZON_YM) lifecycle.push({ ym: back, event: "REINSTATE" });
      }
    }
    contracts.push({ productKey: prod.key, contractDate: date, monthlyPremium: premium, lifecycle });
  }
  return { contracts };
}

function main(): void {
  const entries: Record<string, LlmPlanChunk> = {};
  for (const a of AGENTS) {
    const chunk = fixtureChunk(a);
    const problems = chunkProblems(a, chunk);
    if (problems.length) throw new Error(`${a.agentId}: ${problems.join(" | ")}`);
    entries[`plan:${a.agentId}`] = chunk;
  }
  const file: FixtureFile = {
    kind: "fixture(수기)",
    name: "plan",
    note: "LLM 출력 아님 — gen/scripts/make-plan-fixture.ts가 결정론으로 작성한 수기 픽스처. vcr/plan.json이 없을 때만 --stub 폴백으로 쓴다.",
    entries,
  };
  writeFileSync(fixturePath("plan"), `${JSON.stringify(file, null, 2)}\n`);
  console.log(`fixture(수기): ${Object.keys(entries).length}명 → ${fixturePath("plan")}`);
}

if (import.meta.main) main();
