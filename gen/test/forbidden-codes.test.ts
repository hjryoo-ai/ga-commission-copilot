import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { currentCodes, FORBIDDEN_PATH, withCodes } from "../scripts/forbidden-codes.ts";

// 운영자 2026-11-02: G6 codes는 용어 표 코드 열 + 이벤트 계약 enum에서 만든다(손으로 고치지 않는다).
describe("G6 코드 이름 목록(forbidden:codes)", () => {
  it("packages/grounding/forbidden.json의 codes = 지금 프롬프트 용어 표·계약 enum에서 만든 것(다르면 pnpm run forbidden:codes)", () => {
    const file = JSON.parse(readFileSync(FORBIDDEN_PATH, "utf8")) as { codes: string[] };
    expect(file.codes).toEqual(currentCodes());
    expect(file.codes).toEqual(expect.arrayContaining(["CURVE", "LIMIT_DEFER", "DEFER_AFTER_FY", "CUT", "RELEASED", "SCHEDULED"]));
  });

  it("codes 한 줄만 바꾸고(없으면 patterns 앞에 넣고) 나머지는 그대로", () => {
    const base = '{\n  "phrases": ["확정"],\n  "patterns": []\n}\n';
    const once = withCodes(base, ["B", "A"]);
    expect(once).toBe('{\n  "phrases": ["확정"],\n  "codes": ["B", "A"],\n  "patterns": []\n}\n');
    expect(withCodes(once, ["C"])).toBe('{\n  "phrases": ["확정"],\n  "codes": ["C"],\n  "patterns": []\n}\n');
  });
});
