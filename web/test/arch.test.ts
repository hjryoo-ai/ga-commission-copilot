import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// 설계서 §3.3·CLAUDE.md 규약 2: web은 gen(엔진 대역)도 worker 코드도 import하지 않는다 — web → worker는 API로만. ESLint import-x/no-restricted-paths와 같은 규칙.
const SRC = join(import.meta.dirname, "../src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

function specifiers(src: string): string[] {
  return [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["'`]([^"'`]+)["'`]/gm)].map((m) => m[1]!);
}

const forbidden = (spec: string) => /^@copilot\/(gen|worker)(\/|$)/.test(spec) || /^(\.\.\/)+(gen|worker)(\/|$)/.test(spec);

describe("아키텍처: web/src/** 는 gen·worker를 import하지 않는다", () => {
  const files = walk(SRC);

  it("스캔 대상이 비어 있지 않다", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => ({ path: relative(SRC, f), f })))("$path", ({ f }) => {
    expect(specifiers(readFileSync(f, "utf8")).filter(forbidden)).toEqual([]);
  });

  it("검사기 자체: gen·worker 상대 경로와 패키지 이름을 잡는다", () => {
    const src = 'import a from "../../gen/world/rules/tables.ts";\nimport { h } from "../../worker/src/api/health";\nimport x from "@copilot/gen";\nimport React from "react";\nimport { App } from "./App";';
    expect(specifiers(src).filter(forbidden)).toEqual(["../../gen/world/rules/tables.ts", "../../worker/src/api/health", "@copilot/gen"]);
  });
});
