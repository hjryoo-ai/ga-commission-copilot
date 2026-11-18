// 툴 결과 v2 라벨 표의 범위(설계서 v0.1.44 §4.3.2): 계약 enum·forbidden.json codes가 전부 라벨 표나 "내보내지 않음"에 있고,
// 상위 사본 web/src/labels.ts와 다른 라벨은 명시 목록(differsFromWeb)에만 있다. 파일을 읽어 대조한다(packages는 web을 import하지 않는다).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DIFFERS_FROM_WEB, labeledCodes, type LabelField, labelTable, NOT_EXPORTED } from "@copilot/grounding";
import { describe, expect, it } from "vitest";
import { contractEnumCodes, eventCodes } from "../explain/check-bodies.ts";
import { PROMPTS } from "../explain/generate.ts";
import { REPO_ROOT } from "../providers/prompt.ts";

const forbidden = JSON.parse(readFileSync(join(REPO_ROOT, "packages/grounding/forbidden.json"), "utf8")) as { codes: string[] };

/** web/src/labels.ts의 `export const NAME … = { CODE: "라벨", … }` 한 블록 → 표. */
function webTable(name: string): Record<string, string> {
  const src = readFileSync(join(REPO_ROOT, "web/src/labels.ts"), "utf8");
  const m = src.match(new RegExp(`export const ${name}\\b[^=]*=\\s*\\{([\\s\\S]*?)\\};`));
  if (!m) throw new Error(`web/src/labels.ts에 ${name} 없음`);
  return Object.fromEntries([...m[1]!.matchAll(/([A-Z_]+):\s*"([^"]*)"/g)].map((x) => [x[1]!, x[2]!]));
}
const webCut = () => readFileSync(join(REPO_ROOT, "web/src/labels.ts"), "utf8").match(/export const CUT_LABEL = "([^"]+)"/)![1]!;

describe("라벨 표 범위(v0.1.44)", () => {
  it("이벤트 계약 enum·용어 표 코드·forbidden.json codes는 전부 라벨이 있거나 '내보내지 않음'에 있다(열린 집합 아님)", () => {
    const covered = new Set([...labeledCodes(), ...NOT_EXPORTED]);
    const all = new Set([...contractEnumCodes(), ...eventCodes(PROMPTS.LINE.version), ...forbidden.codes]);
    expect([...all].filter((c) => !covered.has(c)).sort()).toEqual([]);
  });

  it("상위 사본과 다른 라벨은 명시 목록(differsFromWeb)에만 — 목록 밖의 차이·목록에 있는데 같은 것 둘 다 없다", () => {
    const pairs: [LabelField, Record<string, string>][] = [
      ["commType", webTable("COMM_TYPE_LABEL")],
      ["monthStatus", webTable("MONTH_STATUS_LABEL")],
      ["deferralStatus", webTable("DEFERRAL_LABEL")],
      ["limitStage", webTable("STAGE_LABEL")],
      ["limitCutPolicy", { CUT: webCut(), DEFER_AFTER_FY: webCut() }],
    ];
    const differs: string[] = [];
    for (const [field, web] of pairs) for (const [code, label] of Object.entries(labelTable(field))) if (code in web && web[code] !== label) differs.push(code);
    expect(differs.sort()).toEqual(Object.keys(DIFFERS_FROM_WEB).sort());
  });
});
