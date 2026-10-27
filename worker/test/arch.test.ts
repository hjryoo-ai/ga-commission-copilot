import { describe, expect, it } from "vitest";
import { extractStringLiterals, sqlWithoutTenant, writeKeywords } from "./arch-scan";

// CLAUDE.md 규약 3(tenant_id 없는 쿼리 금지)·4(툴은 읽기 전용). 원문은 Vite가 번들 시점에 읽는다(Workers 런타임에는 fs가 없다).
const sources = import.meta.glob<string>("../src/**/*.ts", { query: "?raw", import: "default", eager: true });
const files = Object.entries(sources).map(([key, text]) => ({ path: key.replace(/^\.\.\//, ""), text }));

/**
 * tenant_id 조건 없이 SQL을 가져도 되는 파일. 추가할 때는 이유를 같이 적는다.
 * 테넌트 데이터를 읽지 않거나(연결 확인), 테넌트 열이 없는 전역 표(stream_meta·budget_counter·eval_*·rulebook_chunk)만 다루는 파일만 허용한다.
 */
export const TENANT_SQL_WHITELIST: Record<string, string> = {
  "src/api/health.ts": "D1 연결 확인 SELECT 1 — 테넌트 데이터 없음",
};

describe("아키텍처: worker/src/tools/** 는 읽기 전용", () => {
  const tools = files.filter((f) => f.path.startsWith("src/tools/"));

  it.each(tools.length ? tools : [{ path: "(툴 없음)", text: "" }])("$path 에 INSERT|UPDATE|DELETE 가 없다", ({ text }) => {
    expect(writeKeywords(text)).toEqual([]);
  });
});

describe("아키텍처: worker/src/** 의 SQL 문자열은 tenant_id 조건을 가진다", () => {
  it("스캔 대상이 비어 있지 않다", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.filter((f) => !(f.path in TENANT_SQL_WHITELIST)))("$path", ({ text }) => {
    expect(sqlWithoutTenant(text)).toEqual([]);
  });

  it("화이트리스트 항목은 실제 파일을 가리킨다", () => {
    const paths = new Set(files.map((f) => f.path));
    for (const path of Object.keys(TENANT_SQL_WHITELIST)) expect(paths.has(path), path).toBe(true);
  });
});

describe("스캐너 자체 검사", () => {
  it("툴 금지어를 대소문자 구분 없이 찾는다", () => {
    expect(writeKeywords('db.prepare("insert into x values (1)")')).toEqual(["insert"]);
    expect(writeKeywords("db.prepare(`UPDATE budget_counter SET used = used + 1`)")).toEqual(["UPDATE"]);
    expect(writeKeywords('db.prepare("SELECT * FROM earnings_line WHERE tenant_id = ?")')).toEqual([]);
  });

  it("tenant_id 없는 SQL 문자열을 잡는다", () => {
    expect(sqlWithoutTenant('db.prepare("SELECT * FROM earnings_line WHERE agent_id = ?")')).toHaveLength(1);
    expect(sqlWithoutTenant("db.prepare(`SELECT 1`)")).toHaveLength(1);
    expect(sqlWithoutTenant("db.prepare('DELETE FROM answer_log')")).toHaveLength(1);
  });

  it("tenant_id 조건이 있는 SQL과 SQL이 아닌 문자열은 통과시킨다", () => {
    expect(sqlWithoutTenant('db.prepare("SELECT * FROM earnings_line WHERE tenant_id = ? AND agent_id = ?")')).toEqual([]);
    expect(sqlWithoutTenant('const label = "데모 설계사를 select 하세요";')).toEqual([]);
  });

  it("주석 안의 따옴표·SQL은 문자열로 보지 않는다", () => {
    expect(extractStringLiterals("// don't SELECT 1 FROM x\nconst a = 'ok';")).toEqual(["ok"]);
    expect(extractStringLiterals("/* SELECT * FROM x */ const b = `y`;")).toEqual(["y"]);
  });
});
