import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const get = async () => {
  const res = await exports.default.fetch("https://example.com/api/v1/health");
  expect(res.status).toBe(200);
  return res.json();
};

describe("GET /api/v1/health", () => {
  it("첫 적재 전: {ok:true, d1: SELECT 1 결과, streamHash: null, earningsLines: null}", async () => {
    expect(await get()).toEqual({ ok: true, d1: 1, streamHash: null, earningsLines: null });
  });

  it("활성 스트림의 해시와 그 슬롯의 earnings_line 건수(비활성 슬롯은 세지 않는다)", async () => {
    const line = (table: string, calcId: string) =>
      env.DB.prepare(
        `INSERT INTO ${table} (tenant_id, calc_id, agent_id, policy_no, comm_type, amount, close_ym, basis, policy_summary, source_seq) VALUES ('T1', ?, 'A-1001', 'P1', 'FY_COMM', 1000, '202608', '{}', '{}', 1)`,
      )
        .bind(calcId)
        .run();
    await line("earnings_line_b", "c1");
    await line("earnings_line_b", "c2");
    await line("earnings_line_a", "x1");
    await env.DB.prepare(
      "INSERT INTO stream_meta (stream_hash, generated_at, event_count, plan_prompt_version, verified_at, active, slot) VALUES ('h-b', 't', 2, 'plan/v1', 't', 1, 'b')",
    ).run();
    expect(await get()).toEqual({ ok: true, d1: 1, streamHash: "h-b", earningsLines: 2 });
  });
});
