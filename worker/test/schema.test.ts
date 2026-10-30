import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

// 마이그레이션 0001(설계서 v0.1.1 §5.1, 상위 설계서 v1.9 §5) + 0002(설계서 v0.1.8 A/B 슬롯)
const BASE_READ_MODEL = [
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
  "demo_agents", // 0003(설계서 v0.1.11)
  "explanation",
  "rulebook_chunk",
  "sim_stub",
  "answer_log",
  "budget_counter",
  "eval_run",
  "eval_case_result",
];
const SLOTS = ["a", "b"] as const;
const READ_MODEL = SLOTS.flatMap((s) => BASE_READ_MODEL.map((t) => `${t}_${s}`));
const INDEXES = [
  ...SLOTS.flatMap((s) => ["ix_line_agent_ym", "ix_line_policy", "ix_defer_agent_due"].map((i) => `${i}_${s}`)),
  "ix_expl_agent",
  "ix_ans_created",
];

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

describe("D1 스키마 0001 + 0002 + 0003", () => {
  it("읽기 모델 8개 × 슬롯 2 + 추가 테이블 9개 = 25개 테이블, 원래 이름의 읽기 모델 표는 없다", async () => {
    expect(await names("table")).toEqual([...READ_MODEL, ...COPILOT].sort());
  });

  it("인덱스 8개(상위 3 × 슬롯 2, 이름 <원래이름>_<slot> + §5.1 2) + stream_meta 유일 인덱스 2개", async () => {
    expect(await names("index")).toEqual(expect.arrayContaining(INDEXES));
    const explicit = (await names("index")).filter((n) => n.startsWith("ix_"));
    expect(explicit.sort()).toEqual([...INDEXES].sort());
    expect((await names("index")).filter((n) => n.startsWith("ux_")).sort()).toEqual(["ux_stream_meta_active", "ux_stream_meta_slot"]);
  });

  it.each(BASE_READ_MODEL)("%s: 슬롯 a·b의 열 정의가 같다", async (table) => {
    expect(await columns(`${table}_a`)).toEqual(await columns(`${table}_b`));
  });

  it.each(READ_MODEL)("%s: tenant_id가 첫 컬럼이고 PK에 포함, NOT NULL", async (table) => {
    const cols = await columns(table);
    expect(cols[0]?.name).toBe("tenant_id");
    expect(cols[0]?.pk).toBeGreaterThan(0);
    expect(cols[0]?.notnull).toBe(1);
  });

  it("금액 INTEGER 열은 실수를 거부한다(STRICT, 규약 8)", async () => {
    const insert = env.DB.prepare(
      `INSERT INTO earnings_line_a (tenant_id, calc_id, agent_id, policy_no, comm_type, amount, close_ym, basis, policy_summary, source_seq)
       VALUES ('T1', 'c1', 'A0001', 'P1', 'FY_COMM', ?, '202608', '{}', '{}', 1)`,
    );
    await expect(insert.bind(1.5).run()).rejects.toThrow();
    await expect(insert.bind(2800000).run()).resolves.toBeTruthy();
  });

  it("닫힌 값·월 형식 CHECK가 동작한다", async () => {
    const month = (status: string, ym: string) =>
      env.DB.prepare(
        "INSERT INTO earnings_month_b (tenant_id, agent_id, close_ym, status, last_seq) VALUES ('T1', 'A0001', ?, ?, 1)",
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
        "INSERT INTO policy_flag_a (tenant_id, policy_no, agent_id, flag_type, occurred_on) VALUES (?, 'P1', 'A0001', 'LAPSED', '2027-02-01')",
      )
        .bind(tenant)
        .run();
    await expect(flag("t1")).rejects.toThrow();
    await expect(flag("_T1")).rejects.toThrow();
    await expect(flag("T1")).resolves.toBeTruthy();
  });
});

describe("stream_meta: active=1은 많아야 1행, 전환은 UPDATE 한 문장(설계서 v0.1.8 §5.4)", () => {
  const meta = (hash: string, slot: string, active: number) =>
    env.DB.prepare(
      "INSERT INTO stream_meta (stream_hash, generated_at, event_count, plan_prompt_version, verified_at, active, slot) VALUES (?, 't', 1, 'plan/v1', 't', ?, ?)",
    )
      .bind(hash, active, slot)
      .run();
  const activeCount = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM stream_meta WHERE active = 1").first<{ n: number }>())!.n;
  const SWITCH = "UPDATE stream_meta SET active = CASE WHEN stream_hash = ? THEN 1 ELSE 0 END";

  // 이 파일의 시험들은 같은 저장소를 공유한다 — 슬롯이 둘뿐이라 매번 비운다
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM stream_meta").run();
  });

  it("slot CHECK, 슬롯당 1행, active 둘은 거부", async () => {
    await expect(meta("h0", "c", 0)).rejects.toThrow();
    await meta("h1", "a", 1);
    await expect(meta("h2", "a", 0)).rejects.toThrow();
    await expect(meta("h2", "b", 1)).rejects.toThrow();
    await meta("h2", "b", 0);
    expect(await activeCount()).toBe(1);
  });

  it("활성 행보다 나중에 들어간 행(rowid가 큰 행)으로는 한 문장으로 전환되고 활성은 정확히 1행", async () => {
    await meta("old", "a", 1);
    await meta("new", "b", 0);
    await env.DB.prepare(SWITCH).bind("new").run();
    expect(await activeCount()).toBe(1);
    expect((await env.DB.prepare("SELECT stream_hash FROM stream_meta WHERE active = 1").first<{ stream_hash: string }>())!.stream_hash).toBe("new");
  });

  it("먼저 들어간 행으로 되돌리면 부분 유일 인덱스가 행 단위로 검사돼 문장 전체가 실패하고 아무것도 바뀌지 않는다", async () => {
    // UPDATE는 rowid 순으로 행을 바꾸며 UNIQUE를 행마다 검사한다 — 'old'(rowid 작음)가 먼저 1이 되는 순간 활성이 둘
    await meta("old", "a", 1);
    await meta("new", "b", 0);
    await env.DB.prepare(SWITCH).bind("new").run();
    await expect(env.DB.prepare(SWITCH).bind("old").run()).rejects.toThrow(/UNIQUE/);
    expect((await env.DB.prepare("SELECT stream_hash FROM stream_meta WHERE active = 1").first<{ stream_hash: string }>())!.stream_hash).toBe("new");
    // 적재기의 사전 확인: 대상 행 rowid > 활성 행 rowid
    const order = await env.DB.prepare(
      "SELECT (SELECT rowid FROM stream_meta WHERE stream_hash = ?) > (SELECT rowid FROM stream_meta WHERE active = 1) AS forward",
    )
      .bind("old")
      .first<{ forward: number }>();
    expect(order!.forward).toBe(0);
  });

  it("문장이 실패하면 아무것도 바뀌지 않는다(문장 단위 커밋) — 없는 해시로 전환하면 0행이 되므로 적재기는 해시 존재를 먼저 확인한다", async () => {
    await meta("old", "a", 1);
    await expect(env.DB.prepare("UPDATE stream_meta SET active = 1").run()).resolves.toBeTruthy(); // 1행뿐이라 통과
    await meta("new", "b", 0);
    await expect(env.DB.prepare("UPDATE stream_meta SET active = 1").run()).rejects.toThrow();
    expect(await activeCount()).toBe(1);
  });
});
