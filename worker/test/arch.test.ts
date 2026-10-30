import { describe, expect, it } from "vitest";
import {
  d1Calls,
  extractStringLiterals,
  importSpecifiers,
  moneyArithmetic,
  pointsIntoGen,
  stripCommentsAndStrings,
  slotLiterals,
  sqlWithoutTenant,
  tenantTableSqlWithoutTenant,
  touchesTenantTable,
  writeKeywords,
} from "./arch-scan";

// CLAUDE.md 규약 3(tenant_id 없는 쿼리 금지)·4(툴은 읽기 전용). 원문은 Vite가 번들 시점에 읽는다(Workers 런타임에는 fs가 없다).
const sources = import.meta.glob<string>("../src/**/*.ts", { query: "?raw", import: "default", eager: true });
const files = Object.entries(sources).map(([key, text]) => ({ path: key.replace(/^\.\.\//, ""), text }));
// web도 금액을 계산하지 않는다(설계서 §8 — 상위 화면 규약). 같은 스캐너로 본다.
const webSources = import.meta.glob<string>(["../../web/src/**/*.ts", "../../web/src/**/*.tsx"], { query: "?raw", import: "default", eager: true });
const webFiles = Object.entries(webSources).map(([key, text]) => ({ path: key.replace(/^\.\.\/\.\.\//, ""), text }));
/** 합계·잔여·소진율·단계를 계산하는 유일한 파일(CLAUDE.md 규약 2). */
const DERIVED_FILE = "src/domain/DerivedNumbers.ts";

/**
 * tenant_id 조건 없이 SQL을 가져도 되는 파일. 추가할 때는 이유를 같이 적는다.
 * 테넌트 데이터를 읽지 않거나(연결 확인), 테넌트 열이 없는 전역 표(stream_meta·budget_counter·eval_*·rulebook_chunk)만 다루는 파일만 허용한다.
 * 화이트리스트 파일이어도 테넌트 표(슬롯 표 포함)를 건드리는 SQL은 tenant_id 조건을 가져야 한다(아래 두 번째 검사).
 */
export const TENANT_SQL_WHITELIST: Record<string, string> = {
  "src/db/ScopedQuery.ts": "빌더 SQL은 조립된다(tenant_id·agent_id는 from()이 붙인다 — scoped-query.test.ts). 그 밖에 SELECT 1·stream_meta(전역 표)",
};

/** D1 바인딩을 직접 쓰는(prepare·batch·exec·dump) 유일한 파일(Phase 2 완료 기준 "ScopedQuery 외 D1 접근 0건"). */
const D1_ACCESS_FILE = "src/db/ScopedQuery.ts";

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

  it.each(files)("$path: 테넌트 표(슬롯 표 포함) SQL은 화이트리스트여도 tenant_id 조건을 가진다", ({ text }) => {
    expect(tenantTableSqlWithoutTenant(text)).toEqual([]);
  });

  it("화이트리스트 항목은 실제 파일을 가리킨다", () => {
    const paths = new Set(files.map((f) => f.path));
    for (const path of Object.keys(TENANT_SQL_WHITELIST)) expect(paths.has(path), path).toBe(true);
  });
});

describe("아키텍처: D1 접근은 db/ScopedQuery.ts에만, 슬롯 표 이름은 빌더만 만든다(설계서 v0.1.10 §5.1)", () => {
  it.each(files.filter((f) => f.path !== D1_ACCESS_FILE))("$path: prepare·batch·exec·dump 호출 없음", ({ text }) => {
    expect(d1Calls(text)).toEqual([]);
  });

  it(`${D1_ACCESS_FILE}가 있다`, () => {
    expect(files.some((f) => f.path === D1_ACCESS_FILE)).toBe(true);
  });

  it.each(files)("$path: 슬롯 접미 리터럴(_a·_b) 없음", ({ text }) => {
    expect(slotLiterals(text)).toEqual([]);
  });
});

describe("아키텍처: worker/src/** 는 gen을 import하지 않는다(CLAUDE.md 규약 2 — 엔진 대역은 gen 안에만)", () => {
  it.each(files)("$path", ({ text }) => {
    expect(importSpecifiers(text).filter(pointsIntoGen)).toEqual([]);
  });
});

describe("아키텍처: 금액 사칙연산은 DerivedNumbers.ts에만(CLAUDE.md 규약 2, PHASES Phase 2 항목 4)", () => {
  it(`${DERIVED_FILE}가 있고 web 원문도 스캔한다`, () => {
    expect(files.some((f) => f.path === DERIVED_FILE)).toBe(true);
    expect(webFiles.length).toBeGreaterThan(0);
  });

  it.each([...files.filter((f) => f.path !== DERIVED_FILE), ...webFiles])("$path", ({ text }) => {
    expect(moneyArithmetic(text)).toEqual([]);
  });
});

describe("아키텍처: 응답에 증권번호를 싣지 않는다(상위 §7, 설계서 v0.1.13)", () => {
  // 응답 객체 키로 policyNo·policy_no를 만들지 않는다 — 증권번호는 policyMasked()·policyKeys()와 조회 조건으로만 쓴다
  it.each(files.filter((f) => f.path.startsWith("src/api/")))("$path", ({ text }) => {
    // 객체 리터럴 키(값이 타입 string이 아닌 것)만 센다 — 행 타입 선언·매개변수 타입은 응답이 아니다
    expect(stripCommentsAndStrings(text).match(/[{,]\s*policy_?[nN]o\s*:(?!\s*string\b)/g)?.map(() => "policy_no:") ?? []).toEqual(
      // 조회 조건(where: { policy_no: … })만 허용
      [...stripCommentsAndStrings(text).matchAll(/where:\s*\{[^}]*\bpolicy_no\s*:/g)].map(() => "policy_no:"),
    );
  });
});

describe("스캐너 자체 검사", () => {
  it("응답 키 검사: 객체 리터럴의 policyNo 값은 잡고, 타입 선언·조회 조건은 통과", () => {
    const keys = (t: string) => stripCommentsAndStrings(t).match(/[{,]\s*policy_?[nN]o\s*:(?!\s*string\b)/g) ?? [];
    expect(keys("return { calcId: r.calc_id, policyNo: r.policy_no };")).toHaveLength(1);
    expect(keys("interface R { policy_no: string; }\nq.all<{ policy_no: string }>(t, {});\nfunction f(policyNo: string) {}")).toEqual([]);
  });

  it("금액 필드의 사칙연산·복합 대입·단항 부호를 잡고, 쪽수·달 순번·비교·문자열·주석은 통과시킨다", () => {
    expect(moneyArithmetic("const t = a.amount + b.amount;")).toHaveLength(2);
    expect(moneyArithmetic("sum += line.amount;")).toEqual(["+= line.amount"]);
    expect(moneyArithmetic("const r = row.limit_amount - row.accum_paid;")).toHaveLength(2);
    expect(moneyArithmetic("const x = -p.amount; const y = gross * 2; const z = net / 3;")).toHaveLength(3);
    expect(moneyArithmetic("const pct = (accumPaid * 100) / limitAmount;")).toHaveLength(2);
    expect(moneyArithmetic("const off = page * size; const n = monthIndex(to) - monthIndex(from) + 1; i++;")).toEqual([]);
    expect(moneyArithmetic('if (a.amount >= b.amount && x.gross === y.gross) f({ amount: -200, gross: r.gross }); const s = "amount - net";')).toEqual([]);
    expect(moneyArithmetic("// amount + net\nconst k = `${r.amount + 1}`; const f = (amount) => amount;")).toEqual([]);
  });

  it("D1 직접 호출과 슬롯 접미 리터럴을 잡는다", () => {
    expect(d1Calls("await c.env.DB.prepare(`SELECT 1`).first();\nawait db.batch([a]);\nconst x = arr.prepare;")).toEqual([".prepare(", ".batch("]);
    expect(slotLiterals('const t = "earnings_line_a"; const u = `policy_limit_history_b`; const s = "_b"; const ok = `${table}_${slot}`;')).toEqual([
      "earnings_line_a",
      "policy_limit_history_b",
      "_b",
    ]);
    expect(slotLiterals('type Slot = "a" | "b"; const t = "earnings_line"; const archive = "earnings_line_archive";')).toEqual([]);
  });

  it("gen을 가리키는 import를 잡고 그 밖은 통과시킨다", () => {
    const src = [
      'import { TENANT } from "../../../gen/world/rules/tables.ts";',
      "import type { Plan } from '@copilot/gen/world/plan-types';",
      'const m = await import("../../gen/world/expand.ts");',
      'export { x } from "../../gen";',
      'import { Hono } from "hono";',
      'import { health } from "./api/health";',
      'import { general } from "./general";',
    ].join("\n");
    expect(importSpecifiers(src).filter(pointsIntoGen)).toEqual([
      "../../../gen/world/rules/tables.ts",
      "@copilot/gen/world/plan-types",
      "../../gen/world/expand.ts",
      "../../gen",
    ]);
  });

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

  it("슬롯 표 이름(_a·_b·_${slot})도 테넌트 표로 잡는다", () => {
    for (const t of ["earnings_line_a", "earnings_line_b", "earnings_line_${slot}", "policy_limit_history_${s}", "policy_limit", "agent_profile_a"]) {
      expect(touchesTenantTable(`SELECT * FROM ${t} WHERE agent_id = ?`), t).toBe(true);
    }
    expect(touchesTenantTable("SELECT stream_hash, slot FROM stream_meta WHERE active = 1")).toBe(false);
    expect(touchesTenantTable("SELECT * FROM earnings_line_archive")).toBe(false);
    expect(tenantTableSqlWithoutTenant("db.prepare(`SELECT COUNT(*) FROM earnings_line_${slot}`)")).toHaveLength(1);
    expect(tenantTableSqlWithoutTenant("db.prepare(`SELECT COUNT(*) FROM earnings_line_${slot} WHERE tenant_id = ?`)")).toEqual([]);
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
