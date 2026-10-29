// 시나리오 플랜 생성(설계서 §4.1(a)-1, Phase 1 항목 2).
// 필수 케이스(forced.ts)를 먼저 넣고, 나머지는 설계사 1명당 LLM 1회(prompts/plan/v1.md)로 채운다. 출력은 G1(ajv) + 의미 검사.
//   node world/plan.ts --stub     VCR 재생(vcr/plan.json 없으면 fixtures/plan.fixture.json 수기 픽스처로 폴백)
//   node world/plan.ts --record   Groq 실호출 + VCR 기록(이미 같은 요청 해시로 녹화된 설계사는 건너뜀), dev 예산 차감
//   node world/plan.ts            Groq 실호출(기록 안 함)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reserveDevCall } from "../providers/budget.ts";
import { canonicalHash, openStub, replay, type StubSource, type VcrEntry, vcrPath, writeVcr } from "../providers/cassette.ts";
import { type ChatMessage, groqStructured, ProviderError, requestBody, type StructuredRequest } from "../providers/groq.ts";
import { loadPrompt, render } from "../providers/prompt.ts";
import { AGENT_CONSTRAINTS, AGENTS, type Agent } from "./agents.ts";
import { applyBoundaries, BOUNDARIES, FORCED, FORCED_CASE_COUNT } from "./forced.ts";
import { contractProblems } from "./plan-check.ts";
import type { LlmPlanChunk, Plan, PlanContract } from "./plan-types.ts";
import { CONTRACT_FROM, CONTRACT_TO, HORIZON_YM, PRODUCTS } from "./rules/tables.ts";
import { errorsOf, SCHEMA_IDS, schemaJson, validator } from "./schemas.ts";

export const PROMPT = { name: "plan", version: "v1" } as const;
export const REPAIR_PROMPT = { name: "plan_repair", version: "v1" } as const;
export const OUT_DIR = join(import.meta.dirname, "../out");
const MAX_ATTEMPTS = 3;
const LIVE_SPACING_MS = 20_000; // Groq TPM 8K: 호출당 약 3K 토큰 → 분당 2회 안쪽

export type Mode = "stub" | "record" | "live";

export function agentRequest(a: Agent): { label: string; req: StructuredRequest; hash: string } {
  const p = loadPrompt(PROMPT.name, PROMPT.version);
  const input = {
    agent: { agentId: a.agentId, grade: a.grade },
    count: a.llmContracts,
    products: PRODUCTS.map((x) => ({ key: x.key, premiumMin: x.premiumMin, premiumMax: x.premiumMax })),
    constraints: AGENT_CONSTRAINTS[a.agentId] ?? null,
  };
  const prompt = render(p.body, {
    count: String(a.llmContracts),
    contract_from: CONTRACT_FROM,
    contract_to: CONTRACT_TO,
    horizon: HORIZON_YM,
    input: JSON.stringify(input, null, 2),
  });
  const req: StructuredRequest = {
    model: p.modelHint,
    messages: [{ role: "user", content: prompt }],
    schemaName: "plan_chunk",
    schema: schemaJson(p.outputSchema),
    maxCompletionTokens: 4096,
  };
  return { label: `plan:${a.agentId}`, req, hash: canonicalHash(requestBody(req)) };
}

/** 설계사 1명 몫 LLM 출력 검사. 문제가 없으면 빈 배열. */
export function chunkProblems(a: Agent, chunk: unknown): string[] {
  const v = validator(SCHEMA_IDS.planLlm);
  if (!v(chunk)) return [`G1 plan-llm: ${errorsOf(v)}`];
  const c = chunk as LlmPlanChunk;
  const out: string[] = [];
  if (c.contracts.length !== a.llmContracts) out.push(`계약 수 ${c.contracts.length} ≠ ${a.llmContracts}`);
  c.contracts.forEach((x, i) => {
    for (const p of contractProblems({ ...x, policyNo: "-", agentId: a.agentId }, { llm: true })) out.push(`#${i}: ${p}`);
  });
  return out;
}

/** LLM 계약에 policyNo를 붙인다: POL-<체결연도>-<설계사 2자리><순번 3자리>(5자리 — A-1 예약 POL-2026-0001과 충돌 불가). */
export function assignPolicyNos(a: Agent, chunk: LlmPlanChunk): PlanContract[] {
  const sorted = [...chunk.contracts].sort(
    (x, y) => x.contractDate.localeCompare(y.contractDate) || x.productKey.localeCompare(y.productKey) || x.monthlyPremium - y.monthlyPremium,
  );
  return sorted.map((x, i) => ({
    policyNo: `POL-${x.contractDate.slice(0, 4)}-${String(a.no).padStart(2, "0")}${String(i + 1).padStart(3, "0")}`,
    agentId: a.agentId,
    productKey: x.productKey,
    contractDate: x.contractDate,
    monthlyPremium: x.monthlyPremium,
    lifecycle: x.lifecycle,
  }));
}

export function assemble(chunks: ReadonlyMap<string, LlmPlanChunk>): Plan {
  const llm = AGENTS.flatMap((a) => {
    const c = chunks.get(a.agentId);
    if (!c) throw new Error(`${a.agentId}: LLM 플랜 없음`);
    return assignPolicyNos(a, c);
  });
  const contracts = applyBoundaries([...FORCED, ...llm]).sort(
    (x, y) => x.agentId.localeCompare(y.agentId) || x.contractDate.localeCompare(y.contractDate) || x.policyNo.localeCompare(y.policyNo),
  );
  const plan: Plan = { contracts };
  const problems = planProblems(plan);
  if (problems.length) throw new Error(`플랜 검사 실패:\n${problems.join("\n")}`);
  return plan;
}

/** 합친 플랜 전체 검사: G1(plan.schema) + 필수 케이스 의미 검사 + policyNo 유일. */
export function planProblems(plan: Plan): string[] {
  const v = validator(SCHEMA_IDS.plan);
  if (!v(plan)) return [`G1 plan: ${errorsOf(v)}`];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of plan.contracts) {
    if (seen.has(c.policyNo)) out.push(`policyNo ${c.policyNo} 중복`);
    seen.add(c.policyNo);
    for (const p of contractProblems(c, { llm: !c.forcedCase })) out.push(`${c.policyNo}: ${p}`);
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 거부된 출력에 대한 재질문 메시지(prompts/plan_repair/v1.md). */
function repairMessages(base: StructuredRequest, rejected: unknown, problems: string[]): ChatMessage[] {
  const p = loadPrompt(REPAIR_PROMPT.name, REPAIR_PROMPT.version);
  return [
    ...base.messages,
    { role: "assistant", content: JSON.stringify(rejected) },
    { role: "user", content: render(p.body, { violations: problems.slice(0, 20).join("\n") }) },
  ];
}

async function liveChunk(a: Agent, base: StructuredRequest, hash: string): Promise<{ chunk: LlmPlanChunk; entry: VcrEntry }> {
  let last = "";
  let req = base;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    reserveDevCall();
    try {
      const r = await groqStructured(req);
      const problems = chunkProblems(a, r.json);
      if (problems.length === 0) {
        return {
          chunk: r.json as LlmPlanChunk,
          entry: { requestHash: hash, repairs: attempt - 1, model: r.model, recordedAt: new Date().toISOString(), usage: r.usage, response: r.json },
        };
      }
      last = problems.slice(0, 5).join(" | ");
      console.warn(`[live] ${a.agentId} 시도 ${attempt}: 검사 실패 ${last}`);
      req = { ...base, messages: repairMessages(base, r.json, problems) };
    } catch (e) {
      if (e instanceof ProviderError && e.status === 429) {
        const wait = (e.retryAfterSeconds ?? 30) + 1;
        console.warn(`[live] ${a.agentId} 시도 ${attempt}: 429, ${wait}s 대기`);
        await sleep(wait * 1000);
        last = "429";
        continue;
      }
      throw e;
    }
    await sleep(LIVE_SPACING_MS);
  }
  throw new Error(`${a.agentId}: ${MAX_ATTEMPTS}회 실패 — ${last}`);
}

export async function buildPlan(mode: Mode): Promise<{ plan: Plan; source: string; calls: number }> {
  const chunks = new Map<string, LlmPlanChunk>();
  let calls = 0;
  if (mode === "stub") {
    const src: StubSource = openStub(PROMPT.name);
    for (const a of AGENTS) {
      const { label, hash } = agentRequest(a);
      const chunk = replay(src, label, hash);
      const problems = chunkProblems(a, chunk);
      if (problems.length) throw new Error(`[stub] ${label}: ${problems.slice(0, 5).join(" | ")}`);
      chunks.set(a.agentId, chunk as LlmPlanChunk);
    }
    return { plan: assemble(chunks), source: src.kind, calls };
  }
  const recorded: Record<string, VcrEntry> =
    mode === "record" && existsSync(vcrPath(PROMPT.name)) ? (JSON.parse(readFileSync(vcrPath(PROMPT.name), "utf8")) as { entries: Record<string, VcrEntry> }).entries : {};
  for (const a of AGENTS) {
    const { label, req, hash } = agentRequest(a);
    const prev = recorded[label];
    if (mode === "record" && prev?.requestHash === hash && chunkProblems(a, prev.response).length === 0) {
      chunks.set(a.agentId, prev.response as LlmPlanChunk);
      continue;
    }
    if (calls > 0) await sleep(LIVE_SPACING_MS);
    const { chunk, entry } = await liveChunk(a, req, hash);
    calls++;
    chunks.set(a.agentId, chunk);
    if (mode === "record") {
      recorded[label] = entry;
      writeVcr(PROMPT.name, recorded);
    }
    console.log(`[${mode}] ${label} ok (${chunk.contracts.length}건)`);
  }
  return { plan: assemble(chunks), source: mode === "record" ? "vcr(녹화)" : "live", calls };
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const mode: Mode = args.has("--stub") ? "stub" : args.has("--record") ? "record" : "live";
  const { plan, source, calls } = await buildPlan(mode);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  const boundaries = BOUNDARIES.map((b) => {
    const c = plan.contracts.find((x) => x.forcedCase === b.forcedCase)!;
    return { forcedCase: b.forcedCase, date: b.date, policyNo: c.policyNo, how: c.policyNo === b.inject.policyNo ? "injected" : "tagged" };
  });
  const meta = {
    prompt: `${PROMPT.name}/${PROMPT.version}`,
    repairPrompt: `${REPAIR_PROMPT.name}/${REPAIR_PROMPT.version}`,
    mode,
    source,
    liveCalls: calls,
    contracts: plan.contracts.length,
    forced: FORCED_CASE_COUNT,
    boundaries,
  };
  writeFileSync(join(OUT_DIR, "plan.meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`plan: ${plan.contracts.length}건(강제 ${FORCED_CASE_COUNT} — 경계 ${boundaries.map((b) => `${b.date} ${b.how}`).join(", ")}) source=${source} → gen/out/plan.json`);
}

if (import.meta.main) await main();
