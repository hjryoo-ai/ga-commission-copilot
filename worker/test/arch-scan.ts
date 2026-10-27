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

/** 툴 디렉터리 금지어(읽기 전용 규약). 주석 포함 원문 전체에서 찾는다. */
export function writeKeywords(src: string): string[] {
  return src.match(/\b(INSERT|UPDATE|DELETE)\b/gi) ?? [];
}
