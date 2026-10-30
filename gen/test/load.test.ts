import { describe, expect, it } from "vitest";
import { estimateWrites, indexesPerRow, insertStatements, loadMigration, MAX_STATEMENT_BYTES, READ_MODEL, slotTable, sqlValue } from "../load/sql.ts";

// Phase 1 항목 6: 적재 SQL 생성(실행·재검사는 증거 문서의 load:d1 --local/--remote 로그).
const migration = loadMigration();

describe("SQL 값", () => {
  it("문자열 따옴표 이스케이프, JSON 열은 문자열, NULL", () => {
    expect(sqlValue("O'Brien")).toBe("'O''Brien'");
    expect(sqlValue({ rate: "7", ids: ["a'b"] })).toBe(`'{"rate":"7","ids":["a''b"]}'`);
    expect(sqlValue(null)).toBe("NULL");
    expect(sqlValue(-720_000)).toBe("-720000");
  });

  it("정수가 아닌 수는 거부(규약 8)", () => {
    expect(() => sqlValue(1.5)).toThrow();
    expect(() => sqlValue(2 ** 60)).toThrow();
    expect(() => sqlValue(true)).toThrow();
  });

  it("슬롯은 a·b뿐", () => {
    expect(slotTable("earnings_line", "b")).toBe("earnings_line_b");
    expect(() => slotTable("earnings_line", "c" as "a")).toThrow();
  });
});

describe("다중 행 INSERT", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ calc_id: `c-${i}`, amount: i, basis: { note: "가".repeat(40) } }));

  it("문장마다 90KB 이하로 나누고 행을 빠뜨리지 않는다, tenant_id가 첫 열", () => {
    const st = insertStatements("earnings_line", "a", "T1", rows);
    expect(st.length).toBeGreaterThan(1);
    for (const s of st) {
      expect(Buffer.byteLength(s)).toBeLessThanOrEqual(MAX_STATEMENT_BYTES);
      expect(s.startsWith("INSERT INTO earnings_line_a (tenant_id, calc_id, amount, basis) VALUES\n")).toBe(true);
    }
    expect(st.join("").match(/\('T1', 'c-\d+'/g)).toHaveLength(1000);
  });

  it("행마다 열이 다르면 거부", () => {
    expect(() => insertStatements("earnings_line", "a", "T1", [{ a: 1 }, { b: 1 }])).toThrow(/열이 다르다/);
  });

  it("빈 표는 문장 없음", () => {
    expect(insertStatements("recon", "a", "T1", [])).toEqual([]);
  });
});

describe("rows written 추정(마이그레이션 0002에서 인덱스 수를 센다)", () => {
  it("표별 인덱스 수 = PK 자동 인덱스 + UNIQUE + 보조 인덱스", () => {
    expect(Object.fromEntries(READ_MODEL.map((t) => [t, indexesPerRow(migration, t)]))).toEqual({
      agent_profile: 1,
      earnings_line: 3,
      earnings_month: 1,
      policy_limit: 2,
      policy_limit_history: 1,
      deferral_item: 2,
      clawback_item: 1,
      policy_flag: 1,
    });
  });

  it("Phase 1 스트림 행 수로 약 24,800", () => {
    const counts = { agent_profile: 30, earnings_line: 5200, earnings_month: 962, policy_limit: 182, policy_limit_history: 215, deferral_item: 210, clawback_item: 30, policy_flag: 181 };
    const e = estimateWrites(counts, migration);
    expect(e.rows).toBe(7014); // + demo_agents 3
    expect(e.rowsWritten).toBe(24_826); // + demo_agents 9 + line_count UPDATE 1
  });
});
