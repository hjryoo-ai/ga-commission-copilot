import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../providers/prompt.ts";
import type { DemoAgent } from "../verify/g3.ts";
import { type D1Exec, insertPlan, loadSlot, metaRows, purgeInactive, rollback, slotCounts, type StreamInfo } from "../load/flow.ts";
import { loadMigration, type Row } from "../load/sql.ts";

// Phase 1 항목 6 흐름 시험(+ 설계서 v0.1.11 demo_agents·line_count): 마이그레이션 0001~0004를 node:sqlite에 그대로 적용하고 적재·재개·전환·되돌리기·비우기를 돌린다.
// (D1과 같은 SQLite 엔진이다. 원격 wrangler 실행 자체는 증거 문서의 로그로 본다.)
const MIGRATIONS = ["0001_init.sql", "0002_ab_slots.sql", "0003_demo_agents.sql", "0004_explanation_pk.sql"].map((f) => readFileSync(join(REPO_ROOT, "worker/migrations", f), "utf8"));

function sqliteExec(db: DatabaseSync): D1Exec {
  return {
    query: (sql) => db.prepare(sql).all() as Record<string, unknown>[],
    apply: (statements) => statements.map((s) => ({ changes: Number(db.prepare(s).run().changes) })),
  };
}

/** 최소 뷰: 설계사 1명, 라인 n개(FY_COMM 1,000원씩 + CLAWBACK −200원), 그 달 월 행(합계 일치). */
function views(prefix: string, n: number, grossOverride?: number): Record<string, Row[]> {
  const line = (calcId: string, commType: string, amount: number): Row => ({
    calc_id: calcId,
    agent_id: "A-1001",
    policy_no: "POL-2026-0001",
    comm_type: commType,
    amount,
    close_ym: "202608",
    basis: { rate: "7" },
    policy_summary: {},
    source_seq: 1,
  });
  const lines = [...Array.from({ length: n }, (_, i) => line(`${prefix}-${i}`, "FY_COMM", 1_000)), line(`${prefix}-cb`, "CLAWBACK", -200)];
  return {
    agent_profile: [{ agent_id: "A-1001", name: "허구설계사01", org_path: "/HQ1/BR01/TM01", status: "ACTIVE", valid_from: "2025-07-01", last_seq: 1 }],
    earnings_line: lines,
    earnings_month: [{ agent_id: "A-1001", close_ym: "202608", gross: grossOverride ?? n * 1_000, clawback_offset: -200, adjustment: 0, status: "ESTIMATED", last_seq: 1 }],
  };
}

const demo = (agentIds: readonly string[]): DemoAgent[] =>
  agentIds.map((agentId, i) => ({ demoNo: (i + 1) as 1 | 2 | 3, agentId, scenario: `A${i + 1}` as "A1", cardLabel: `카드 ${i + 1}`, contractCount: 1, basis: { seq: i } }));
const info = (hash: string, agents = ["A-1001", "A-1002", "A-1003"]): StreamInfo => ({ hash, generatedAt: "2026-10-30T00:00:00Z", eventCount: 1, planPrompt: "plan/v1", demoAgents: demo(agents) });
const demoRows = (x: D1Exec) => x.query("SELECT stream_hash, demo_no, agent_id FROM demo_agents ORDER BY stream_hash, demo_no").map((r) => `${r.stream_hash}${r.demo_no}=${r.agent_id}`);
const lineCounts = (x: D1Exec) => Object.fromEntries(x.query("SELECT stream_hash, line_count FROM stream_meta").map((r) => [r.stream_hash, r.line_count]));
const opts = { migrationSql: loadMigration(), log: () => {}, now: () => "2026-10-30T00:00:00Z" };
const activeHash = (x: D1Exec) => metaRows(x).active?.stream_hash ?? null;
const activeCount = (x: D1Exec) => Number(x.query("SELECT COUNT(*) AS n FROM stream_meta WHERE active = 1")[0]!.n);

let sqlite: DatabaseSync;
let db: D1Exec;
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const m of MIGRATIONS) sqlite.exec(m);
  db = sqliteExec(sqlite);
});

describe("적재 → 전환", () => {
  it("첫 적재는 슬롯 a, 재검사 통과 뒤 active=1 정확히 1행", () => {
    const r = loadSlot(db, info("X"), views("x", 3), opts);
    expect(r).toMatchObject({ slot: "a", resumed: false, activeAfter: { n: 1, hash: "X", slot: "a" } });
    expect(slotCounts(db, "a")).toMatchObject({ agent_profile: 1, earnings_line: 4, earnings_month: 1 });
  });

  it("④에 demo_agents 3행이 함께 들어가고, ⑤ 재검사 행 수가 stream_meta.line_count에 쓰인다", () => {
    loadSlot(db, info("X"), views("x", 3), opts);
    expect(demoRows(db)).toEqual(["X1=A-1001", "X2=A-1002", "X3=A-1003"]);
    expect(lineCounts(db)).toEqual({ X: 4 });
  });

  it("meta.demoAgents가 3명이 아니면 쓰기 전에 멈춘다", () => {
    expect(() => loadSlot(db, info("X", ["A-1001", "A-1002"]), views("x", 3), opts)).toThrow(/2명/);
    expect(metaRows(db).rows).toEqual([]);
    expect(slotCounts(db, "a").earnings_line).toBe(0);
  });

  it("0003 이전에 적재돼 이미 활성인 스트림은 슬롯 표를 건드리지 않고 demo_agents만 채운다", () => {
    loadSlot(db, info("X"), views("x", 3), opts);
    sqlite.exec("DELETE FROM demo_agents");
    const applied: string[][] = [];
    const spy: D1Exec = { query: db.query, apply: (s, l) => (applied.push([...s]), db.apply(s, l)) };
    expect(loadSlot(spy, info("X"), views("x", 3), opts).noop).toBe(true);
    expect(applied).toEqual([[expect.stringMatching(/^INSERT INTO demo_agents /)]]);
    expect(demoRows(db)).toHaveLength(3);
    // 다시 돌리면 아무것도 쓰지 않고, meta와 다르면 멈춘다
    expect(loadSlot(spy, info("X"), views("x", 3), opts).noop).toBe(true);
    expect(applied).toHaveLength(1);
    expect(() => loadSlot(db, info("X", ["A-1001", "A-1003", "A-1002"]), views("x", 3), opts)).toThrow(/≠ meta/);
  });

  it("두 번째 스트림은 비어 있는 슬롯 b로, 전환 뒤 a는 그대로 남는다", () => {
    loadSlot(db, info("X"), views("x", 3), opts);
    expect(loadSlot(db, info("Y"), views("y", 5), opts).activeAfter).toEqual({ n: 1, hash: "Y", slot: "b" });
    expect(slotCounts(db, "a").earnings_line).toBe(4);
    expect(loadSlot(db, info("Y"), views("y", 5), opts).noop).toBe(true);
  });

  it("월 합산이 틀린 뷰는 재검사에서 멈추고 전환하지 않는다", () => {
    loadSlot(db, info("X"), views("x", 3), opts);
    expect(() => loadSlot(db, info("Y"), views("y", 5, 4_999), opts)).toThrow(/월 합산 불일치 1/);
    expect(activeHash(db)).toBe("X");
  });

  it("비활성 슬롯이 비어 있지 않으면(이전 스트림) 적재를 거부한다 — 먼저 --purge-inactive", () => {
    loadSlot(db, info("X"), views("x", 3), opts);
    loadSlot(db, info("Y"), views("y", 5), opts);
    expect(() => loadSlot(db, info("Z"), views("z", 2), opts)).toThrow(/비어 있지 않다/);
    purgeInactive(db, () => {});
    expect(demoRows(db).map((r) => r[0])).toEqual(["Y", "Y", "Y"]); // 비운 슬롯의 demo_agents도 지운다
    expect(loadSlot(db, info("Z"), views("z", 2), opts).activeAfter).toEqual({ n: 1, hash: "Z", slot: "a" });
  });
});

describe("재개 경로: 같은 해시가 비활성 슬롯에 같은 행 수로 있으면 ⑤부터", () => {
  it("④까지 적용되고 멈춘 상태에서 다시 실행하면 INSERT 없이 재검사·전환만 한다", () => {
    loadSlot(db, info("X"), views("x", 3), opts);
    // 원격 1회차처럼 ④(슬롯 b INSERT + stream_meta active=0)만 끝난 상태를 만든다
    db.apply(insertPlan("b", info("Y"), views("y", 5), "2026-10-30T00:00:00Z"), "partial");
    const applied: string[][] = [];
    const spy: D1Exec = { query: db.query, apply: (s, l) => (applied.push([...s]), db.apply(s, l)) };
    const r = loadSlot(spy, info("Y"), views("y", 5), opts);
    expect(r).toMatchObject({ resumed: true, activeAfter: { n: 1, hash: "Y", slot: "b" } });
    expect(applied.flat().some((s) => s.startsWith("INSERT"))).toBe(false);
    expect(slotCounts(db, "b").earnings_line).toBe(6);
    expect(lineCounts(db)).toEqual({ X: 4, Y: 6 });
  });

  it("행 수가 다르면(부분 적재) 이어 가지 않고 멈춘다", () => {
    loadSlot(db, info("X"), views("x", 3), opts);
    db.apply(insertPlan("b", info("Y"), views("y", 5), "t").filter((s) => !s.startsWith("INSERT INTO earnings_month_b")), "partial");
    expect(() => loadSlot(db, info("Y"), views("y", 5), opts)).toThrow(/맞지 않는다/);
    expect(activeHash(db)).toBe("X");
  });
});

describe("되돌리기(v0.1.10 §5.4): 같은 해시·같은 슬롯 행을 새 rowid로 → 같은 UPDATE 한 문장(INSERT + UPDATE 두 문장)", () => {
  it("이전 스트림으로 재적재 없이 되돌리고, 다시 앞으로도 되돌린다 — 매번 active=1 정확히 1행", () => {
    loadSlot(db, info("X"), views("x", 3), opts);
    loadSlot(db, info("Y"), views("y", 5), opts);
    // 같은 UPDATE를 그냥 쓰면 X(rowid 작음)가 먼저 1이 되어 부분 유일 인덱스에 걸린다
    expect(() => db.apply(["UPDATE stream_meta SET active = CASE WHEN stream_hash = 'X' THEN 1 ELSE 0 END"], "naive")).toThrow(/UNIQUE/);
    expect(activeHash(db)).toBe("Y");

    const applied: string[][] = [];
    const spy: D1Exec = { query: db.query, apply: (s, l) => (applied.push([...s]), db.apply(s, l)) };
    const r = rollback(spy, "X", { agent_profile: 1, earnings_line: 4, earnings_month: 1, policy_limit: 0, policy_limit_history: 0, deferral_item: 0, clawback_item: 0, policy_flag: 0 }, () => {});
    expect(r.activeAfter).toEqual({ n: 1, hash: "X", slot: "a" });
    expect(activeCount(db)).toBe(1);
    // 슬롯 표에는 쓰지 않았다: stream_meta 다시 넣기 1문장 + 전환 1문장
    expect(applied).toHaveLength(2);
    expect(applied[0]![0]).toMatch(/^INSERT OR REPLACE INTO stream_meta /);
    expect(applied[1]![0]).toMatch(/^UPDATE stream_meta SET active = CASE WHEN stream_hash = 'X'/);
    expect(slotCounts(db, "a").earnings_line).toBe(4);
    expect(slotCounts(db, "b").earnings_line).toBe(6);

    expect(rollback(db, "Y", null, () => {}).activeAfter).toEqual({ n: 1, hash: "Y", slot: "b" });
    expect(metaRows(db).rows.map((x) => x.stream_hash)).toEqual(["X", "Y"]);
    expect(lineCounts(db)).toEqual({ X: 4, Y: 6 }); // 다시 넣어도 line_count가 따라간다
    expect(demoRows(db)).toHaveLength(6);
  });

  it("이전 슬롯을 이미 비웠으면 되돌릴 수 없다", () => {
    loadSlot(db, info("X"), views("x", 3), opts);
    loadSlot(db, info("Y"), views("y", 5), opts);
    purgeInactive(db, () => {});
    expect(() => rollback(db, "X", null, () => {})).toThrow(/없음/);
    expect(activeHash(db)).toBe("Y");
  });
});
