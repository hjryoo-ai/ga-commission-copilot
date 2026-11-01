import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ScopedQuery } from "../src/db/ScopedQuery";
import { InvalidToolCall, parseToolCall, runTool, serialize, type ToolCall } from "../src/tools";
import { approxTokens, fitList, LIST_CUT, matchPolicies, TOOL_RESULT_MAX_TOKENS } from "../src/tools/result";
import { HASH, seed } from "./fixture";

// PHASES Phase 4 항목 2 — 툴 4종(설계서 §4.3). 전부 ScopedQuery(세션 설계사), agentId는 인자에 없다. 결과에 증권번호 원문이 없다.
const ctxOf = (agentId: string) => ({ q: new ScopedQuery(env.DB, { tenantId: "T1", agentId, stream: { streamHash: HASH, slot: "a" } }) });
const run = (agentId: string, tool: string, args: Record<string, string>) => runTool(ctxOf(agentId), parseToolCall({ tool, args }));
const noPolicyNo = (data: unknown) => expect(serialize(data as Record<string, unknown>)).not.toMatch(/POL-\d{4}-\d{4,5}/);

beforeEach(async () => {
  await seed();
  await env.DB.prepare("DELETE FROM sim_stub").run();
});

describe("get_statement(ym)", () => {
  it("월 행 + 유형별 합계 + 라인 요약 — 한도 삭감 라인은 요청액(DerivedNumbers)", async () => {
    const r = await run("A-1001", "get_statement", { ym: "202608" });
    expect(r.data).toMatchObject({ found: true, closeYm: "202608", status: "PAID", gross: 1_800_000, withholdingTax: 59_400, net: 1_740_600, lineCount: 4 });
    expect(r.data.byType).toEqual({ FY_COMM: 1_000_000, INCENTIVE: 800_000 });
    const lines = r.data.lines as Record<string, unknown>[];
    expect(lines.find((l) => l.calcId === "c2")).toMatchObject({ amount: 800_000, limitCutAmt: 200_000, limitCutPolicy: "CUT", requested: 1_000_000, policyMasked: "*********0001" });
    expect(lines.find((l) => l.calcId === "1")).not.toHaveProperty("requested");
    noPolicyNo(r.data);
    expect(r.tokens).toBeLessThanOrEqual(TOOL_RESULT_MAX_TOKENS);
  });

  it("세션 설계사의 행만 — 같은 달이라도 남의 라인은 없고, 없는 달은 found=false", async () => {
    const r = await run("A-1002", "get_statement", { ym: "202608" });
    expect((r.data.lines as { calcId: string }[]).map((l) => l.calcId)).toEqual(["d1"]);
    expect((await run("A-1001", "get_statement", { ym: "202612" })).data).toEqual({ found: false, closeYm: "202612" });
  });
});

describe("get_limit(policyNo) — 뒷자리 매칭", () => {
  it("\"***0001\"·\"0001\"·\"0001 계약\" 모두 원장 1, 잔여·소진율·단계와 이력·삭감 라인·연결 이연", async () => {
    for (const arg of ["*********0001", "0001", "0001 계약"]) {
      const r = await run("A-1001", "get_limit", { policyNo: arg });
      expect(r.data.ledger, arg).toMatchObject({ ledgerId: "1", policyMasked: "*********0001", limitAmount: 1_800_000, accumPaid: 1_800_000, remaining: 0, utilization: "100.0%", stage: "FULL" });
    }
    const r = await run("A-1001", "get_limit", { policyNo: "0001" });
    expect(r.data.history).toEqual([
      { kind: "POST", calcId: "1", amount: 1_000_000, accumAfter: 1_000_000, limitAfter: 1_800_000, utilizationAfter: "55.5%", occurredAt: "2026-08-01T00:00:00Z" },
      { kind: "POST", calcId: "c2", amount: 800_000, accumAfter: 1_800_000, limitAfter: 1_800_000, utilizationAfter: "100.0%", occurredAt: "2026-08-02T00:00:00Z" },
    ]);
    expect(r.data.limitCuts).toEqual([{ calcId: "c2", closeYm: "202608", commType: "INCENTIVE", amount: 800_000, limitCutAmt: 200_000, limitCutPolicy: "CUT", requested: 1_000_000 }]);
    expect(r.data.deferrals).toEqual([{ scheduleId: "s-1", dueYm: "202701", amount: 200_000, status: "SCHEDULED", reason: "LIMIT_DEFER" }]);
    noPolicyNo(r.data);
  });

  it("남의 증권번호(뒷자리 9999)는 찾지 못한다 — 다른 설계사의 원장이 섞이지 않는다", async () => {
    expect((await run("A-1001", "get_limit", { policyNo: "9999" })).data).toEqual({ found: false, ambiguous: false, candidates: [] });
    expect((await run("A-1009", "get_limit", { policyNo: "9999" })).data).toMatchObject({ found: true, ledger: { ledgerId: "l-A1009-01" } });
  });

  it("matchPolicies: 숫자 4자리 미만은 매칭하지 않고, 끝 4자리가 같으면 모두 후보", () => {
    expect(matchPolicies(["POL-2026-0001", "POL-2027-0001", "POL-2026-0002"], "***0001")).toEqual(["POL-2026-0001", "POL-2027-0001"]);
    expect(matchPolicies(["POL-2026-0001"], "001")).toEqual([]);
  });
});

describe("get_deferrals(from, to)", () => {
  it("예정월이 기간 안인 항목, 월별·상태별 합계(DerivedNumbers.sumBy)", async () => {
    const r = await run("A-1001", "get_deferrals", { from: "202701", to: "202712" });
    expect(r.data).toMatchObject({ from: "202701", to: "202712", itemCount: 1, byMonth: { "202701": 200_000 }, byStatus: { SCHEDULED: 200_000 } });
    expect(r.data.items).toEqual([{ scheduleId: "s-1", policyMasked: "*********0001", dueYm: "202701", amount: 200_000, status: "SCHEDULED", reason: "LIMIT_DEFER" }]);
    expect((await run("A-1001", "get_deferrals", { from: "202801", to: "202812" })).data).toMatchObject({ itemCount: 0, items: [] });
  });
});

describe("get_policy_event_sim(policyNo) — sim_stub 조회", () => {
  const stub = (agent: string, policyNo: string) =>
    env.DB.prepare("INSERT INTO sim_stub (tenant_id, agent_id, policy_no, kind, response, rule_snapshot_id) VALUES ('T1', ?, ?, 'POLICY_EVENT', ?, 'snap-1')")
      .bind(agent, policyNo, JSON.stringify({ policyNo, event: "CANCEL", clawbackAmount: -720_000, offsetAgainstMonth: "202702" }))
      .run();

  it("스텁이 없으면 found=false·NO_STUB(→ NEEDS_ENGINE)", async () => {
    expect((await run("A-1001", "get_policy_event_sim", { policyNo: "0001" })).data).toEqual({ found: false, reason: "NO_STUB", policyMasked: "*********0001" });
  });

  it("스텁 응답을 그대로(증권번호는 마스킹), 남의 스텁은 보이지 않는다", async () => {
    await stub("A-1001", "POL-2026-0001");
    await stub("A-1009", "POL-2026-9999");
    const r = await run("A-1001", "get_policy_event_sim", { policyNo: "***0001" });
    expect(r.data).toEqual({ found: true, policyMasked: "*********0001", ruleSnapshotId: "snap-1", simulation: { policyNo: "*********0001", event: "CANCEL", clawbackAmount: -720_000, offsetAgainstMonth: "202702" } });
    noPolicyNo(r.data);
    expect((await run("A-1001", "get_policy_event_sim", { policyNo: "9999" })).data).toMatchObject({ found: false, reason: "NO_POLICY" });
  });
});

describe("툴 호출 검사(LLM 계획 출력)", () => {
  const bad = (raw: unknown) => expect(() => parseToolCall(raw)).toThrow(InvalidToolCall);
  it("알 수 없는 툴·agentId 등 덧붙인 인자·형식 틀린 값·36개월 넘는 기간을 거부한다", () => {
    bad({ tool: "run_sql", args: {} });
    bad({ tool: "get_statement", args: { ym: "202608", agentId: "A-1009" } });
    bad({ tool: "get_statement", args: { ym: "2026-08" } });
    bad({ tool: "get_statement", args: { ym: 202608 } });
    bad({ tool: "get_limit", args: { policyNo: "'; DROP TABLE x" } });
    bad({ tool: "get_deferrals", args: { from: "202701", to: "202612" } });
    bad({ tool: "get_deferrals", args: { from: "202501", to: "202801" } });
    expect(parseToolCall({ tool: "get_deferrals", args: { to: "202712", from: "202701" } })).toEqual<ToolCall>({ tool: "get_deferrals", args: { to: "202712", from: "202701" } });
  });
});

describe("결과 크기 ≤ 1,200토큰(넘으면 목록 30건 컷, 그래도 넘으면 더 줄임)", () => {
  const make = (xs: readonly number[]) => ({ head: "x", items: xs.map((i) => ({ calcId: `c-A1001-${i}-1`, commType: "FY_COMM", amount: 1_000_000 + i, policyMasked: "*********0001" })) });
  it("작으면 그대로, 크면 30건 이하로 잘라 Shown·Total을 붙인다", () => {
    expect(fitList(make, "items", [1, 2, 3])).toMatchObject({ truncated: false, data: { items: [{}, {}, {}] } });
    const big = fitList(make, "items", Array.from({ length: 200 }, (_, i) => i));
    expect(big.truncated).toBe(true);
    expect(big.data.itemsTotal).toBe(200);
    expect(big.data.itemsShown as number).toBeLessThanOrEqual(LIST_CUT);
    expect((big.data.items as unknown[]).length).toBe(big.data.itemsShown);
    expect(approxTokens(serialize(big.data))).toBeLessThanOrEqual(TOOL_RESULT_MAX_TOKENS);
  });
  it("토큰 추정: ASCII 2.5자당 1, 그 밖 1자당 1(보수적)", () => {
    expect(approxTokens("abcde")).toBe(2);
    expect(approxTokens("한도")).toBe(2);
  });
});
