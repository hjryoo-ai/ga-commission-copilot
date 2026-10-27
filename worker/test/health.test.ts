import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("GET /api/v1/health", () => {
  it("{ok:true, d1: SELECT 1 결과}를 돌려준다", async () => {
    const res = await exports.default.fetch("https://example.com/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, d1: 1 });
  });
});
