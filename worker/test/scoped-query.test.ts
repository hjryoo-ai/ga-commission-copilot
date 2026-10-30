import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { activeStream, ScopedQuery, type ActiveStream } from "../src/db/ScopedQuery";

// PHASES Phase 2 항목 2: tenant_id·agent_id·활성 슬롯을 생성자에서 받아 모든 SQL에 강제한다(CLAUDE.md 규약 3, 설계서 v0.1.10 §5.1).
// 시험 데이터는 슬롯 표에 직접 넣는다(이 파일은 src가 아니라 아키텍처 스캔 대상이 아니다).
const A: ActiveStream = { streamHash: "h-a", slot: "a" };
const B: ActiveStream = { streamHash: "h-b", slot: "b" };

async function line(table: string, tenant: string, agent: string, calcId: string, amount: number) {
  await env.DB.prepare(
    `INSERT INTO ${table} (tenant_id, calc_id, agent_id, policy_no, comm_type, amount, close_ym, basis, policy_summary, source_seq) VALUES (?, ?, ?, 'P1', 'FY_COMM', ?, '202608', '{}', '{}', 1)`,
  )
    .bind(tenant, calcId, agent, amount)
    .run();
}

beforeEach(async () => {
  for (const t of ["earnings_line_a", "earnings_line_b", "stream_meta"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
  await line("earnings_line_a", "T1", "A-1001", "a1", 100);
  await line("earnings_line_a", "T1", "A-1001", "a2", 200);
  await line("earnings_line_a", "T1", "A-1002", "a3", 300); // 다른 설계사
  await line("earnings_line_a", "T2", "A-1001", "a4", 400); // 다른 테넌트
  await line("earnings_line_b", "T1", "A-1001", "b1", 900); // 다른 슬롯
});

describe("ScopedQuery", () => {
  it("생성자 범위(테넌트·설계사·슬롯)의 행만 돌려준다", async () => {
    const q = new ScopedQuery(env.DB, { tenantId: "T1", agentId: "A-1001", stream: A });
    const rows = await q.all<{ calc_id: string }>("earnings_line", { columns: ["calc_id"], orderBy: "calc_id" });
    expect(rows.map((r) => r.calc_id)).toEqual(["a1", "a2"]);
  });

  it("활성 슬롯이 바뀌면 같은 코드가 다른 슬롯 표를 읽는다", async () => {
    const q = new ScopedQuery(env.DB, { tenantId: "T1", agentId: "A-1001", stream: B });
    expect((await q.all<{ calc_id: string }>("earnings_line", { columns: ["calc_id"] })).map((r) => r.calc_id)).toEqual(["b1"]);
  });

  it("타인 calcId는 조건을 줘도 0행(인가 — 404의 근거)", async () => {
    const q = new ScopedQuery(env.DB, { tenantId: "T1", agentId: "A-1001", stream: A });
    expect(await q.first("earnings_line", { columns: ["calc_id"], where: { calc_id: "a3" } })).toBeNull();
    expect(await q.first("earnings_line", { columns: ["calc_id"], where: { calc_id: "a4" } })).toBeNull();
  });

  it("모든 문장에 tenant_id·agent_id 바인딩이 앞에 붙고, 값은 전부 바인딩된다", () => {
    const q = new ScopedQuery(env.DB, { tenantId: "T1", agentId: "A-1001", stream: A });
    const { sql, params } = q.build("earnings_month", { columns: ["close_ym", "gross"], where: { close_ym: [">=", "202601"], status: "PAID" }, orderBy: "close_ym DESC", limit: 12 });
    expect(sql).toBe("SELECT close_ym, gross FROM earnings_month_a WHERE tenant_id = ? AND agent_id = ? AND close_ym >= ? AND status = ? ORDER BY close_ym DESC LIMIT 12");
    expect(params).toEqual(["T1", "A-1001", "202601", "PAID"]);
  });

  it("tenant_id·agent_id를 where로 덮어쓸 수 없고, 식별자·연산자·정렬·limit 주입을 거부한다", () => {
    const q = new ScopedQuery(env.DB, { tenantId: "T1", agentId: "A-1001", stream: A });
    expect(() => q.build("earnings_line", { columns: ["calc_id"], where: { agent_id: "A-1002" } })).toThrow(/생성자/);
    expect(() => q.build("earnings_line", { columns: ["calc_id; DROP TABLE x"] })).toThrow(/identifier/);
    expect(() => q.build("earnings_line", { columns: ["calc_id"], where: { "1=1 OR calc_id": "x" } })).toThrow(/identifier/);
    expect(() => q.build("earnings_line", { columns: ["calc_id"], where: { amount: ["<> 0 OR 1 =" as "=", 1] } })).toThrow(/operator/);
    expect(() => q.build("earnings_line", { columns: ["calc_id"], orderBy: "calc_id; --" })).toThrow(/order by/);
    expect(() => q.build("earnings_line", { columns: ["calc_id"], limit: 0 })).toThrow(/limit/);
    expect(() => q.build("stream_meta" as "earnings_line", { columns: ["slot"] })).toThrow(/read-model/);
  });

  it("IN·BETWEEN·IS NULL·DISTINCT·OFFSET·COUNT도 범위 조건 뒤에 붙고 값은 바인딩된다", async () => {
    const q = new ScopedQuery(env.DB, { tenantId: "T1", agentId: "A-1001", stream: A });
    const b = q.build("earnings_line", { columns: ["calc_id"], distinct: true, where: { calc_id: ["IN", ["a1", "a3"]], close_ym: ["BETWEEN", "202601", "202612"], reversal_of_calc_id: ["IS NULL"] }, orderBy: "calc_id", limit: 10, offset: 5 });
    expect(b.sql).toBe(
      "SELECT DISTINCT calc_id FROM earnings_line_a WHERE tenant_id = ? AND agent_id = ? AND calc_id IN (?, ?) AND close_ym BETWEEN ? AND ? AND reversal_of_calc_id IS NULL ORDER BY calc_id LIMIT 10 OFFSET 5",
    );
    expect(b.params).toEqual(["T1", "A-1001", "a1", "a3", "202601", "202612"]);
    // a3은 다른 설계사의 라인 — IN에 넣어도 나오지 않는다
    expect((await q.all<{ calc_id: string }>("earnings_line", { columns: ["calc_id"], where: { calc_id: ["IN", ["a1", "a3", "a4"]] } })).map((r) => r.calc_id)).toEqual(["a1"]);
    expect(await q.count("earnings_line")).toBe(2);
    expect(await q.count("earnings_line", { where: { amount: [">", 150] } })).toBe(1);
    expect(() => q.build("earnings_line", { columns: ["calc_id"], where: { calc_id: ["IN", []] } })).toThrow(/IN/);
    expect(() => q.build("earnings_line", { columns: ["calc_id"], offset: 1 })).toThrow(/offset/);
    expect(() => q.build("earnings_line", { columns: ["calc_id"], where: { calc_id: ["LIKE" as "=", "%"] } })).toThrow(/operator/);
  });

  it("agent_id 열이 없는 policy_limit_history는 소유 원장 부분 질의로 두 조건을 건다", async () => {
    await env.DB.prepare("DELETE FROM policy_limit_a").run();
    await env.DB.prepare("DELETE FROM policy_limit_history_a").run();
    for (const [ledger, agent] of [["L1", "A-1001"], ["L2", "A-1002"]]) {
      await env.DB.prepare(
        "INSERT INTO policy_limit_a (tenant_id, ledger_id, agent_id, policy_no, contract_date, fy_start, fy_end, monthly_premium, limit_multiple, limit_amount, rule_version_id) VALUES ('T1', ?, ?, ?, '2026-08-01', '2026-08-01', '2027-07-31', 1, '12', 12, '1')",
      ).bind(ledger, agent, `P-${ledger}`).run();
      await env.DB.prepare("INSERT INTO policy_limit_history_a (tenant_id, ledger_id, source_seq, kind) VALUES ('T1', ?, 1, 'POST')").bind(ledger).run();
    }
    const q = new ScopedQuery(env.DB, { tenantId: "T1", agentId: "A-1001", stream: A });
    const b = q.build("policy_limit_history", { columns: ["ledger_id"] });
    expect(b.sql).toBe("SELECT ledger_id FROM policy_limit_history_a WHERE tenant_id = ? AND ledger_id IN (SELECT ledger_id FROM policy_limit_a WHERE tenant_id = ? AND agent_id = ?)");
    expect(b.params).toEqual(["T1", "T1", "A-1001"]);
    expect(await q.all("policy_limit_history", { columns: ["ledger_id"] })).toEqual([{ ledger_id: "L1" }]);
    expect(await q.first("policy_limit_history", { columns: ["ledger_id"], where: { ledger_id: "L2" } })).toBeNull();
  });

  it("범위가 비었거나 슬롯이 이상하면 만들 수 없다", () => {
    expect(() => new ScopedQuery(env.DB, { tenantId: "T1", agentId: "", stream: A })).toThrow();
    expect(() => new ScopedQuery(env.DB, { tenantId: "T1", agentId: "A-1001", stream: { streamHash: "x", slot: "c" as "a" } })).toThrow(/slot/);
  });
});

describe("activeStream", () => {
  it("첫 적재 전에는 null, 적재 뒤에는 active=1 행의 해시·슬롯", async () => {
    expect(await activeStream(env.DB)).toBeNull();
    await env.DB.prepare(
      "INSERT INTO stream_meta (stream_hash, generated_at, event_count, plan_prompt_version, verified_at, active, slot) VALUES ('h-b', 't', 1, 'plan/v1', 't', 1, 'b')",
    ).run();
    expect(await activeStream(env.DB)).toEqual({ streamHash: "h-b", slot: "b", generatedAt: "t", lineCount: null });
  });
});
