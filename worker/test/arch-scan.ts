// 아키텍처 테스트용 원문 스캐너(CLAUDE.md 규약 3·4). 런타임 코드가 아니라 test/에만 둔다.

/** 소스에서 문자열 리터럴('…', "…", `…`)만 뽑는다. 주석 안의 따옴표는 무시한다. 템플릿의 ${…}는 리터럴 일부로 둔다. */
export function extractStringLiterals(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "/" && next === "/") {
      const end = src.indexOf("\n", i);
      i = end === -1 ? src.length : end;
    } else if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) {
        if (src[j] === "\\") j++;
        if (ch !== "`" && src[j] === "\n") break;
        j++;
      }
      out.push(src.slice(i + 1, j));
      i = j + 1;
    } else {
      i++;
    }
  }
  return out;
}

const SQL_PATTERN = /\bSELECT\b[\s\S]*?(\bFROM\b|\d)|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b|\bREPLACE\s+INTO\b/i;

export function isSqlLiteral(literal: string): boolean {
  return SQL_PATTERN.test(literal);
}

/** tenant_id 조건이 없는 SQL 문자열 목록. */
export function sqlWithoutTenant(src: string): string[] {
  return extractStringLiterals(src).filter((s) => isSqlLiteral(s) && !/\btenant_id\b/.test(s));
}

/**
 * 테넌트 열이 있는 표(읽기 모델 8표 + §5.1의 explanation·sim_stub·answer_log). 슬롯 표 이름(설계서 v0.1.8)도 잡는다:
 * `earnings_line_a`·`earnings_line_b`·`earnings_line_${slot}` 같은 접미 형태. 뒤에 다른 이름 글자가 이어지면(예: policy_limit_history) 그 표로 본다.
 */
const TENANT_TABLE =
  /\b(?:agent_profile|earnings_line|earnings_month|policy_limit_history|policy_limit|deferral_item|clawback_item|policy_flag|explanation|sim_stub|answer_log)(?:_[ab]|_\$\{[^}]*\})?(?![A-Za-z0-9_])/;

export function touchesTenantTable(literal: string): boolean {
  return TENANT_TABLE.test(literal);
}

/** 테넌트 표를 건드리는데 tenant_id 조건이 없는 SQL 문자열 — 화이트리스트 파일에도 적용한다. */
export function tenantTableSqlWithoutTenant(src: string): string[] {
  return extractStringLiterals(src).filter((s) => isSqlLiteral(s) && touchesTenantTable(s) && !/\btenant_id\b/.test(s));
}

/** 툴 디렉터리 금지어(읽기 전용 규약). 주석 포함 원문 전체에서 찾는다. */
export function writeKeywords(src: string): string[] {
  return src.match(/\b(INSERT|UPDATE|DELETE)\b/gi) ?? [];
}

/** import·export from·동적 import의 모듈 지정자. */
export function importSpecifiers(src: string): string[] {
  return [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["'`]([^"'`]+)["'`]/gm)].map((m) => m[1]!);
}

/** gen 패키지를 가리키는 지정자(상대 경로의 gen/ 디렉터리 또는 @copilot/gen) — CLAUDE.md 규약 2: 엔진 대역은 gen 밖으로 새지 않는다. */
export function pointsIntoGen(spec: string): boolean {
  return /^@copilot\/gen(\/|$)/.test(spec) || /^(\.\.?\/)+(\.\.\/)*gen(\/|$)/.test(spec) || /\/gen\/(world|providers|verify|load)\b/.test(spec);
}

