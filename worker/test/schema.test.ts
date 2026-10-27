import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// 마이그레이션 0001(설계서 v0.1.1 §5.1, 상위 설계서 v1.9 §5)
const READ_MODEL = [
  "agent_profile",
  "earnings_line",
  "earnings_month",
  "policy_limit",
  "policy_limit_history",
  "deferral_item",
  "clawback_item",
  "policy_flag",
];
const COPILOT = [
  "stream_meta",
  "explanation",
  "rulebook_chunk",
  "sim_stub",
  "answer_log",
  "budget_counter",
  "eval_run",
  "eval_case_result",
];
const INDEXES = ["ix_line_agent_ym", "ix_line_policy", "ix_defer_agent_due", "ix_expl_agent", "ix_ans_created"];

async function names(type: "table" | "index"): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY name",
  )
    .bind(type)
    .all<{ name: string }>();
  return results.map((r) => r.name);
}

async function columns(table: string): Promise<{ name: string; pk: number; notnull: number }[]> {
  const { results } = await env.DB.prepare("SELECT name, pk, \"notnull\" FROM pragma_table_info(?)").bind(table).all<{ name: string; pk: number; notnull: number }>();
  return results;
}

describe("D1 스키마 0001", () => {
  it("읽기 모델 8개 + 추가 테이블 8개 = 16개 테이블", async () => {
    expect(await names("table")).toEqual([...READ_MODEL, ...COPILOT].sort());
  });

  it("인덱스 5개(상위 3 + §5.1 2)", async () => {
    expect(await names("index")).toEqual(expect.arrayContaining(INDEXES));
    const explicit = (await names("index")).filter((n) => n.startsWith("ix_"));
    expect(explicit.sort()).toEqual([...INDEXES].sort());
  });

  it.each(READ_MODEL)("%s: tenant_id가 첫 컬럼이고 PK에 포함, NOT NULL", async (table) => {
    const cols = await columns(table);
    expect(cols[0]?.name).toBe("tenant_id");
    expect(cols[0]?.pk).toBeGreaterThan(0);
    expect(cols[0]?.notnull).toBe(1);
  });

  it("금액 INTEGER 열은 실수를 거부한다(STRICT, 규약 8)", async () => {
    const insert = env.DB.prepare(
      `INSERT INTO earnings_line (tenant_id, calc_id, agent_id, policy_no, comm_type, amount, close_ym, basis, policy_summary, source_seq)
       VALUES ('T1', 'c1', 'A0001', 'P1', 'FY_COMM', ?, '202608', '{}', '{}', 1)`,
    );
    await expect(insert.bind(1.5).run()).rejects.toThrow();
    await expect(insert.bind(2800000).run()).resolves.toBeTruthy();
  });

  it("닫힌 값·월 형식 CHECK가 동작한다", async () => {
    const month = (status: string, ym: string) =>
      env.DB.prepare(
        "INSERT INTO earnings_month (tenant_id, agent_id, close_ym, status, last_seq) VALUES ('T1', 'A0001', ?, ?, 1)",
      )
        .bind(ym, status)
        .run();
    await expect(month("DONE", "202608")).rejects.toThrow();
    await expect(month("ESTIMATED", "202613")).rejects.toThrow();
    await expect(month("ESTIMATED", "202608")).resolves.toBeTruthy();
  });

  it("tenant_id 형식 CHECK(상위 TenantId 규칙)", async () => {
    const flag = (tenant: string) =>
      env.DB.prepare(
        "INSERT INTO policy_flag (tenant_id, policy_no, agent_id, flag_type, occurred_on) VALUES (?, 'P1', 'A0001', 'LAPSED', '2027-02-01')",
      )
        .bind(tenant)
        .run();
    await expect(flag("t1")).rejects.toThrow();
    await expect(flag("_T1")).rejects.toThrow();
    await expect(flag("T1")).resolves.toBeTruthy();
  });
});
