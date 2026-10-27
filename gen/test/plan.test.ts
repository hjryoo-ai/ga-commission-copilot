import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixtureChunk } from "../scripts/make-plan-fixture.ts";
import { fixturePath } from "../providers/cassette.ts";
import { loadPrompt, render } from "../providers/prompt.ts";
import { AGENTS } from "../world/agents.ts";
import { A1_RESERVED, FORCED } from "../world/forced.ts";
import { agentRequest, buildPlan, chunkProblems, planProblems } from "../world/plan.ts";
import { PRODUCTS } from "../world/rules/tables.ts";
import { schemaJson } from "../world/schemas.ts";

// Phase 1 항목 2: 플랜 = 필수 케이스(코드 주입) + 설계사별 LLM 출력. --stub은 vcr 없으면 수기 픽스처로 폴백.
const { plan, source } = await buildPlan("stub");

describe("world:plan --stub", () => {
  it("출처는 vcr 또는 fixture(수기)다", () => {
    expect(["vcr", "fixture(수기)"]).toContain(source);
  });

  it("필수 케이스 12건이 플랜에 그대로 들어 있다", () => {
    expect(FORCED).toHaveLength(12);
    for (const f of FORCED) expect(plan.contracts).toContainEqual(f);
    expect(new Set(FORCED.map((f) => f.forcedCase)).size).toBe(12);
  });

  it("설계사 30명, 계약 약 400건(부록 B), 설계사별 비강제 계약 8~20건", () => {
    expect(new Set(plan.contracts.map((c) => c.agentId)).size).toBe(30);
    expect(plan.contracts.length).toBeGreaterThanOrEqual(380);
    expect(plan.contracts.length).toBeLessThanOrEqual(440);
    for (const a of AGENTS) {
      expect(a.llmContracts).toBeGreaterThanOrEqual(8);
      expect(a.llmContracts).toBeLessThanOrEqual(20);
    }
  });

  it("G1(plan.schema) + 의미 검사 통과", () => {
    expect(planProblems(plan)).toEqual([]);
  });

  it("A-1 예약 policyNo는 A-1 계약만 쓴다", () => {
    expect(plan.contracts.filter((c) => c.policyNo === A1_RESERVED.policyNo).map((c) => c.forcedCase)).toEqual(["A1"]);
  });

  it("데모 설계사 1(A-1001)의 다른 계약은 202608·202702 합계를 건드리지 않는다", () => {
    const others = plan.contracts.filter((c) => c.agentId === "A-1001" && c.forcedCase !== "A1");
    expect(others.length).toBeGreaterThan(0);
    for (const c of others) {
      expect(c.contractDate >= "2026-03-01").toBe(true);
      expect(["2026-08", "2027-02"]).not.toContain(c.contractDate.slice(0, 7));
      expect(c.lifecycle).toEqual([]);
    }
  });
});

describe("LLM 출력 검사(chunkProblems)", () => {
  const a = AGENTS[3]!;
  const good = fixtureChunk(a);

  it("수기 픽스처 작성기 출력은 통과", () => {
    expect(chunkProblems(a, good)).toEqual([]);
  });

  it("금액 필드·모르는 상품·범위 밖 보험료·계약 수 불일치·이벤트 순서 오류를 거부한다", () => {
    const c0 = good.contracts[0]!;
    expect(chunkProblems(a, { contracts: [{ ...c0, commissionAmount: 1 }, ...good.contracts.slice(1)] })[0]).toMatch(/^G1/);
    expect(chunkProblems(a, { contracts: [{ ...c0, productKey: "REAL-INSURER-X" }, ...good.contracts.slice(1)] })[0]).toMatch(/^G1/);
    expect(chunkProblems(a, { contracts: [{ ...c0, monthlyPremium: 1_000 }, ...good.contracts.slice(1)] }).join()).toMatch(/범위/);
    expect(chunkProblems(a, { contracts: good.contracts.slice(1) }).join()).toMatch(/계약 수/);
    const bad = { ...c0, lifecycle: [{ ym: "202801", event: "CANCEL" as const }, { ym: "202802", event: "LAPSE" as const }] };
    expect(chunkProblems(a, { contracts: [bad, ...good.contracts.slice(1)] }).join()).toMatch(/해약·철회 뒤/);
  });

  it("A-1001 제약 위반(202608 체결)을 거부한다", () => {
    const a1 = AGENTS[0]!;
    const chunk = fixtureChunk(a1);
    const bad = { contracts: [{ ...chunk.contracts[0]!, contractDate: "2026-08-20" }, ...chunk.contracts.slice(1)] };
    expect(chunkProblems(a1, bad).join()).toMatch(/202608 체결 금지/);
  });
});

describe("프롬프트·스키마 정합", () => {
  it("prompts/plan/v1.md frontmatter와 자리표시자", () => {
    const p = loadPrompt("plan", "v1");
    expect(p.outputSchema).toBe("contracts/plan/v1/plan-llm.schema.json");
    expect(() => render(p.body, {})).toThrow(/count/);
    expect(agentRequest(AGENTS[0]!).req.messages[0]!.content).not.toMatch(/\{\{/);
    expect(loadPrompt("plan_repair", "v1").body).toMatch(/\{\{violations\}\}/);
  });

  it("LLM 스키마의 상품 enum = 요율표 상품", () => {
    const s = schemaJson("contracts/plan/v1/plan-llm.schema.json") as { properties: { contracts: { items: { properties: { productKey: { enum: string[] } } } } } };
    expect(s.properties.contracts.items.properties.productKey.enum).toEqual(PRODUCTS.map((p) => p.key));
  });

  it("수기 픽스처 파일은 kind=fixture(수기)로 표기되어 있다", () => {
    const f = JSON.parse(readFileSync(fixturePath("plan"), "utf8")) as { kind: string; note: string };
    expect(f.kind).toBe("fixture(수기)");
    expect(f.note).toMatch(/LLM 출력 아님/);
  });
});
