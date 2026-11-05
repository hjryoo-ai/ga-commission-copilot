import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AnswerFixture, currentFixture, demoViews, FIXTURE_PATH, fixtureText } from "../scripts/answer-fixture.ts";

// 운영자 2026-11-02: 답변 재생 픽스처(worker/test/fixtures/demo-stream.json)는 스크립트가 data/에서 만든다 — 손 복사 금지, 스트림이 바뀌면 따라온다.
const java = spawnSync("java", ["-version"]).status === 0;

describe("답변 재생 픽스처(fixture:answer)", () => {
  it("데모 설계사 행만 — agent_id로, policy_limit_history는 그 설계사들의 원장으로", () => {
    const views = {
      agent_profile: [{ agent_id: "A-1" }, { agent_id: "A-9" }],
      policy_limit: [
        { agent_id: "A-1", ledger_id: "1" },
        { agent_id: "A-9", ledger_id: "9" },
      ],
      policy_limit_history: [{ ledger_id: "1" }, { ledger_id: "9" }],
    };
    const sub = demoViews(views, ["A-1"]);
    expect([sub.agent_profile, sub.policy_limit!.map((l) => l.ledger_id), sub.policy_limit_history, sub.earnings_line]).toEqual([[{ agent_id: "A-1" }], ["1"], [{ ledger_id: "1" }], []]);
    expect(() => demoViews({ policy_flag: [{ policy_no: "x" }] }, ["A-1"])).toThrow(/거를 수 없다/);
  });

  it.skipIf(!java)("커밋된 픽스처 = 지금 data/stream·data/rulebook·contracts/sim으로 만든 것(다르면 pnpm run fixture:answer)", () => {
    const committed = readFileSync(FIXTURE_PATH, "utf8");
    const now = currentFixture();
    expect((JSON.parse(committed) as AnswerFixture).streamHash, "스트림이 바뀌었다 — pnpm run fixture:answer").toBe(now.streamHash);
    expect(committed === fixtureText(now), "픽스처가 data와 다르다 — pnpm run fixture:answer").toBe(true);
    expect(now.demoAgents.map((d) => d.agentId)).toHaveLength(3);
    expect(now.statements.at(-1)).toMatch(/^UPDATE stream_meta SET active = 1/);
    // 리플레이(projection-java)만 CI에서 5.3초(2026-11-05 ci 42… 기본 5초 초과) — explain-stream의 beforeAll과 같은 여유
  }, 600_000);
});
