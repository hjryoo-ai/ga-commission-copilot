import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixtureChunk } from "../scripts/make-plan-fixture.ts";
import { fixturePath } from "../providers/cassette.ts";
import { loadPrompt, render } from "../providers/prompt.ts";
import { AGENTS } from "../world/agents.ts";
import { A1_RESERVED, applyBoundaries, BOUNDARIES, FORCED, FORCED_CASE_COUNT } from "../world/forced.ts";
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

  it("경계 4건: 2026-06-30은 필수 케이스 계약 POL-2026-0012, 나머지는 그 날짜 LLM 계약 태깅(중복 주입 없음) 또는 주입 — 강제 케이스 15건", () => {
    expect(FORCED_CASE_COUNT).toBe(15);
    expect(plan.contracts.filter((c) => c.forcedCase)).toHaveLength(15);
    expect(plan.contracts.find((c) => c.forcedCase === "BOUNDARY_LIMIT_BEFORE")!.policyNo).toBe("POL-2026-0012");
    for (const b of BOUNDARIES) {
      const tagged = plan.contracts.filter((c) => c.forcedCase === b.forcedCase);
      expect(tagged).toHaveLength(1);
      expect(tagged[0]!.contractDate).toBe(b.date);
      const injected = tagged[0]!.policyNo === b.inject.policyNo && !FORCED.includes(b.inject);
      // 주입은 그 날짜에 붙일 계약이 없을 때만, 태깅했으면 주입 계약은 없다
      if (injected) expect(plan.contracts.filter((c) => c.contractDate === b.date && !c.forcedCase)).toEqual([]);
      else if (!FORCED.includes(b.inject)) expect(plan.contracts.some((c) => c.policyNo === b.inject.policyNo)).toBe(false);
    }
    expect(BOUNDARIES.map((b) => b.date)).toEqual(["2026-06-30", "2026-07-01", "2026-12-31", "2027-01-01"]);
  });

  it("경계 적용은 멱등·결정론: 태깅된 플랜에 다시 적용해도 그대로, 태그를 지우고 다시 적용하면 같은 결과", () => {
    expect(applyBoundaries(plan.contracts)).toEqual(plan.contracts);
    // LLM 출력 뒤 단계만 되돌린다: 주입 계약을 빼고 LLM 계약의 경계 표식을 지운다(FORCED는 그대로)
    const isForced = (c: { policyNo: string }) => FORCED.some((f) => f.policyNo === c.policyNo);
    const stripped = plan.contracts
      .filter((c) => isForced(c) || !BOUNDARIES.some((b) => b.inject.policyNo === c.policyNo))
      .map(({ forcedCase, ...rest }) => (forcedCase && (isForced(rest) || !BOUNDARIES.some((b) => b.forcedCase === forcedCase)) ? { ...rest, forcedCase } : rest));
    const again = applyBoundaries(stripped);
    const key = (cs: readonly { policyNo: string; forcedCase?: string }[]) => cs.map((c) => `${c.policyNo}:${c.forcedCase ?? ""}`).sort();
    expect(key(again)).toEqual(key(plan.contracts));
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
