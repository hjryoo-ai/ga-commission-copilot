import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { validate } from "./contract";
import { GENERATED_AT, HASH, login, OTHER_HASH, seed } from "./fixture";

// PHASES Phase 2 항목 1·3·6, 설계서 v0.1.12 §7: 세션·인가 매트릭스·거부 바이트·캐시·응답 스키마(상위 계약 + 덧씌우기).
const app = exports.default;
const get = (path: string, cookie?: string, headers: Record<string, string> = {}) =>
  app.fetch(new Request(`https://example.com${path}`, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } }));

const SCHEMA_OF: [RegExp, string][] = [
  [/^\/api\/v1\/me$/, "MeResponse"],
  [/^\/api\/v1\/me\/earnings\?/, "EarningsResponse"],
  [/^\/api\/v1\/me\/earnings\/lines\//, "LineDetailResponse"],
  [/^\/api\/v1\/me\/earnings\/\d{6}\/lines/, "LinesResponse"],
  [/^\/api\/v1\/me\/earnings\/\d{6}$/, "MonthResponse"],
  [/^\/api\/v1\/me\/limits(\?|$)/, "LimitsResponse"],
  [/^\/api\/v1\/me\/limits\//, "LimitDetailResponse"],
];

/** 200을 확인하고 응답을 계약으로 검증한 뒤 본문을 돌려준다. */
async function ok(path: string, cookie: string): Promise<Record<string, any>> {
  const res = await get(path, cookie);
  const body = (await res.json()) as Record<string, any>;
  expect(res.status, `${path} ${JSON.stringify(body)}`).toBe(200);
  const schema = SCHEMA_OF.find(([re]) => re.test(path))![1];
  expect(validate(schema, body), `${path} → ${schema}`).toEqual([]);
  return body;
}

const PROBLEM = { 401: { code: "UNAUTHENTICATED", message: "데모 설계사를 먼저 선택하세요" }, 404: { code: "NOT_FOUND", message: "찾을 수 없습니다" }, 400: { code: "INVALID_REQUEST", message: "요청 형식이 올바르지 않습니다" } };

async function rejected(res: Response, status: 400 | 401 | 404) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toBe("application/problem+json");
  expect(await res.json()).toEqual(PROBLEM[status]);
}

const ME_PATHS = [
  "/api/v1/me",
  "/api/v1/me/earnings?from=202601&to=202612",
  "/api/v1/me/earnings/202608",
  "/api/v1/me/earnings/202608/lines",
  "/api/v1/me/earnings/lines/1",
  "/api/v1/me/limits",
  "/api/v1/me/limits/1",
];

let one: string;
beforeEach(async () => {
  await seed();
  one = await login(app, 1);
});

describe("세션(PHASES Phase 2 항목 1)", () => {
  it("데모 번호 → 활성 스트림 demo_agents의 설계사로 서명 쿠키(HttpOnly·Secure·SameSite=Lax)", async () => {
    const res = await app.fetch(new Request("https://example.com/api/v1/demo/session", { method: "POST", body: JSON.stringify({ demoAgent: 2 }), headers: { "Content-Type": "application/json" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validate("SessionResponse", body)).toEqual([]);
    expect(body).toMatchObject({ agentId: "A-1002", agentName: "허구설계사02", asOf: { streamHash: HASH, generatedAt: GENERATED_AT, demoNo: 2 } });
    const cookie = res.headers.get("Set-Cookie")!;
    expect(cookie).toMatch(/^copilot_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it("번호가 1·2·3이 아니거나 본문이 깨지면 400", async () => {
    for (const body of ['{"demoAgent":4}', '{"demoAgent":"1"}', "{}", "not json", '{"demoAgent":1,"agentId":"A-1009"}']) {
      await rejected(await app.fetch(new Request("https://example.com/api/v1/demo/session", { method: "POST", body, headers: { "Content-Type": "application/json" } })), 400);
    }
  });

  it("공개 카드: 활성 스트림의 3명(이름·등급·소속·계약 수·카드 문구)", async () => {
    const res = await get("/api/v1/demo/agents");
    const body = (await res.json()) as Record<string, any>;
    expect(validate("DemoAgentsResponse", body)).toEqual([]);
    expect(body.items.map((x: any) => [x.demoNo, x.agentName, x.cardLabel, x.contractCount])).toEqual([
      [1, "허구설계사01", "한도 100% 소진 계약 보유", 2],
      [2, "허구설계사02", "분급제 계약 보유", 3],
      [3, "허구설계사03", "재산정·환수 상계 있음", 4],
    ]);
  });
});

describe("인가 매트릭스(PHASES Phase 2 항목 6)", () => {
  it.each(ME_PATHS)("쿠키 없음 → 401 %s", async (path) => {
    await rejected(await get(path), 401);
  });

  it.each(ME_PATHS)("서명이 틀린 쿠키 → 401 %s", async (path) => {
    const [name, value] = one.split("=");
    const forged = `${name}=${encodeURIComponent(decodeURIComponent(value!).replace("A-1001", "A-1009"))}`;
    await rejected(await get(path, forged), 401);
  });

  it("스트림이 바뀌어 그 데모 번호의 설계사가 달라지면 같은 쿠키도 401", async () => {
    await env.DB.prepare("UPDATE demo_agents SET stream_hash = ? WHERE stream_hash = ?").bind(OTHER_HASH, HASH).run();
    await env.DB.prepare("INSERT INTO demo_agents (stream_hash, demo_no, tenant_id, agent_id, scenario, card_label, contract_count, basis) VALUES (?, 1, 'T1', 'A-1009', 'A1', 'x', 1, '{}')").bind(HASH).run();
    await rejected(await get("/api/v1/me", one), 401);
  });

  it("타인 calcId·ledgerId·월은 404(없는 자원과 같은 바이트)", async () => {
    await rejected(await get("/api/v1/me/earnings/lines/z1", one), 404);
    await rejected(await get("/api/v1/me/earnings/lines/없는키", one), 404);
    await rejected(await get("/api/v1/me/limits/l-POL-2026-9999", one), 404);
    const two = await login(app, 2);
    await rejected(await get("/api/v1/me/earnings/lines/1", two), 404);
    await rejected(await get("/api/v1/me/limits/1", two), 404);
    await rejected(await get("/api/v1/me/earnings/202609", two), 404);
    await rejected(await get("/api/v1/me/earnings/202609/lines", two), 404);
  });

  it("타인 증권의 policyKey는 빈 목록(키를 SQL에 넣지 않는다)", async () => {
    const nine = (await ok("/api/v1/me/earnings/202608/lines", await login(app, 2))).items[0].policyKey as string;
    const r = await ok(`/api/v1/me/earnings/202608/lines?policyKey=${nine}`, one);
    expect(r).toMatchObject({ total: 0, items: [] });
  });

  it("범위 이탈: 다른 설계사의 라인·한도가 목록에 섞이지 않는다", async () => {
    const lines = await ok("/api/v1/me/earnings/202608/lines", one);
    expect(lines.items.map((l: any) => l.calcId)).toEqual(["1", "c2", "c3", "c3r"]);
    const limits = await ok("/api/v1/me/limits", one);
    expect(limits.items.map((l: any) => l.ledgerId)).toEqual(["1", "l-POL-2026-0002"]);
  });
});

describe("거부·형식(상위 §7)", () => {
  it("쿼리 형식·범위 오류는 400", async () => {
    for (const p of [
      "/api/v1/me/earnings",
      "/api/v1/me/earnings?from=202601",
      "/api/v1/me/earnings?from=202613&to=202614",
      "/api/v1/me/earnings?from=202612&to=202601",
      "/api/v1/me/earnings?from=202301&to=202601", // 37개월
      "/api/v1/me/earnings/202608/lines?page=-1",
      "/api/v1/me/earnings/202608/lines?size=0",
      "/api/v1/me/earnings/202608/lines?size=201",
      "/api/v1/me/earnings/202608/lines?commType=fy",
      "/api/v1/me/earnings/202608/lines?policyKey=XYZ",
      "/api/v1/me/limits?status=OK",
    ]) {
      await rejected(await get(p, one), 400);
    }
    await ok("/api/v1/me/earnings?from=202301&to=202512", one); // 36개월
  });

  it("경로 변수 형식 오류·없는 달·없는 경로·메서드 불일치는 404", async () => {
    await rejected(await get("/api/v1/me/earnings/2026-08", one), 404);
    await rejected(await get("/api/v1/me/earnings/202613/lines", one), 404);
    await rejected(await get("/api/v1/me/earnings/202501", one), 404);
    await rejected(await get("/api/v1/me/earnings/202501/lines", one), 404);
    await rejected(await get("/api/v1/nope", one), 404);
    await rejected(await app.fetch(new Request("https://example.com/api/v1/me", { method: "DELETE", headers: { Cookie: one } })), 404);
  });
});

describe("캐시(설계서 v0.1.12 §7)", () => {
  it("private, no-cache + Vary: Cookie + W/\"<streamHash>.<demoNo>\", If-None-Match가 맞으면 304", async () => {
    const res = await get("/api/v1/me/earnings/202608", one);
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(res.headers.get("Vary")).toBe("Cookie");
    const etag = res.headers.get("ETag")!;
    expect(etag).toBe(`W/"${HASH}.1"`);
    const again = await get("/api/v1/me/earnings/202608", one, { "If-None-Match": etag });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
  });

  it("다른 데모 설계사는 ETag가 다르고, 남의 자원은 ETag가 맞아도 304가 아니라 404", async () => {
    const two = await login(app, 2);
    const etag2 = (await get("/api/v1/me", two)).headers.get("ETag");
    expect(etag2).toBe(`W/"${HASH}.2"`);
    expect((await get("/api/v1/me", one, { "If-None-Match": etag2! })).status).toBe(200);
    await rejected(await get("/api/v1/me/earnings/lines/1", two, { "If-None-Match": etag2! }), 404);
  });
});

describe("응답(상위 §7 구조 + 덧씌우기)", () => {
  it.each(ME_PATHS)("%s — 공통 필드·고정 문구·계약 스키마", async (path) => {
    const body = await ok(path, one);
    expect(body.asOf).toEqual({ streamHash: HASH, generatedAt: GENERATED_AT, demoNo: 1 });
    expect(body.dataStatus).toBe("OK");
    expect(body.disclaimer).toBe("가상 데모 데이터 · 설계사 참고용 · 비확정 · 고객 제시 불가");
  });

  it("증권번호 원문은 어느 응답에도 없다(policyMasked·policyKey만)", async () => {
    // 값이 증권번호 그대로인 필드·policyNo 키가 없다. (데모 세계의 원장·라인 ID는 gen이 증권번호를 넣어 만든다 — ID 값 안의 부분 문자열은 따로 본다)
    const policies = new Set(["POL-2026-0001", "POL-2026-0002"]);
    const values = (x: unknown): unknown[] => (x && typeof x === "object" ? Object.values(x).flatMap(values) : [x]);
    for (const p of ME_PATHS) {
      const body = await ok(p, one);
      expect(values(body).filter((v) => typeof v === "string" && policies.has(v)), p).toEqual([]);
      expect(JSON.stringify(body), p).not.toMatch(/"policy_?[nN]o"/);
    }
    const line = (await ok("/api/v1/me/earnings/lines/1", one)).line;
    expect(line.policyMasked).toBe("*********0001");
    expect(line.policyKey).toMatch(/^[0-9a-f]{16}$/);
  });

  it("/me: 프로필·데모 테넌트 값·월 범위", async () => {
    expect(await ok("/api/v1/me", one)).toMatchObject({
      agentId: "A-1001",
      role: "AGENT",
      agentName: "허구설계사01",
      tenant: { name: "데모GA", payoutDayRule: "NEXT_MONTH_D10", limitWarnBp: 8000, limitCritBp: 9500 },
      months: { from: "202608", to: "202609" },
    });
  });

  it("월: byType(라인 유형별 합)·지급예정일·전월 원값, 선택 필드는 null 없이 생략", async () => {
    const m = await ok("/api/v1/me/earnings/202609", one);
    expect(m).toMatchObject({
      closeYm: "202609",
      status: "ESTIMATED",
      monthDataStatus: "OK",
      gross: -700_000,
      clawbackOffset: -100_000,
      byType: { CLAWBACK: -100_000, FY_COMM: -1_000_000, RENEWAL: 300_000 },
      payoutExpectedOn: "2026-10-10",
      previous: { closeYm: "202608", status: "PAID", gross: 1_800_000, net: 1_740_600, netBasis: "PAYOUT" },
    });
    expect(Object.keys(m.byType)).toEqual(["CLAWBACK", "FY_COMM", "RENEWAL"]);
    expect(JSON.stringify(m)).not.toContain("null");
    expect(m).not.toHaveProperty("paidAt");
  });

  it("월 합산이 라인 Σ와 다르면 그 달만 monthDataStatus DRIFT(목록·상세 같게)", async () => {
    await env.DB.prepare("UPDATE earnings_month_a SET gross = gross + 1 WHERE agent_id = 'A-1001' AND close_ym = '202608'").run();
    expect((await ok("/api/v1/me/earnings/202608", one)).monthDataStatus).toBe("DRIFT");
    const list = await ok("/api/v1/me/earnings?from=202608&to=202609", one);
    expect(list.items.map((x: any) => [x.closeYm, x.monthDataStatus])).toEqual([
      ["202608", "DRIFT"],
      ["202609", "OK"],
    ]);
  });

  it("라인 목록: 평평하게, 정렬 source_seq·calc_id, 같은 달·다른 달 취소 짝 연결, 페이지·필터", async () => {
    const p = await ok("/api/v1/me/earnings/202608/lines", one);
    expect(p).toMatchObject({ closeYm: "202608", page: 0, size: 50, total: 4 });
    const by = Object.fromEntries(p.items.map((l: any) => [l.calcId, l]));
    expect(by.c3).toMatchObject({ reversedBy: "c3r", reversedByYm: "202608" });
    expect(by.c3r).toMatchObject({ reversalOf: "c3", reversalOfYm: "202608", amount: -500_000 });
    expect(by["1"]).toMatchObject({ reversedBy: "c5", reversedByYm: "202609" });
    expect(by.c2).toMatchObject({ limitCutAmt: 200_000, limitCutPolicy: "CUT" });
    const sep = await ok("/api/v1/me/earnings/202609/lines", one);
    expect(sep.items.find((l: any) => l.calcId === "c5")).toMatchObject({ reversalOf: "1", reversalOfYm: "202608" });

    const page1 = await ok("/api/v1/me/earnings/202608/lines?page=1&size=3", one);
    expect(page1).toMatchObject({ page: 1, size: 3, total: 4 });
    expect(page1.items.map((l: any) => l.calcId)).toEqual(["c3r"]);
    expect((await ok("/api/v1/me/earnings/202608/lines?commType=INCENTIVE", one)).items.map((l: any) => l.calcId)).toEqual(["c2"]);
    const key = by.c3.policyKey as string;
    const f = await ok(`/api/v1/me/earnings/202608/lines?policyKey=${key}`, one);
    expect(f.items.map((l: any) => l.calcId)).toEqual(["c3", "c3r"]);
  });

  it("라인 상세: 근거·계약 요약·분급·채권·원장 ID, explanation은 null", async () => {
    const d = await ok("/api/v1/me/earnings/lines/c2", one);
    expect(d).toMatchObject({
      basis: { rate: "7", payoutRate: "0.9", ruleVersionIds: ["COMM_RATE:FY_COMM/inst=null:rateId=1001,v=1"] },
      policySummary: { contractDate: "2026-08-01", monthlyPremium: 150_000 },
      deferrals: [{ scheduleId: "s-1", dueYm: "202701", amount: 200_000, status: "SCHEDULED" }],
      ledgerId: "1",
      explanation: null,
    });
    expect((await ok("/api/v1/me/earnings/lines/c7", one)).receivable).toEqual({ receivableId: "r-A-1001-1", amount: 100_000, remaining: 0, status: "CLOSED" });
  });

  it("한도: 잔여·소진율·단계(DerivedNumbers), 열린 플래그만, 상품 키, 단계 필터", async () => {
    const l = await ok("/api/v1/me/limits", one);
    expect(l.items[0]).toMatchObject({ ledgerId: "1", remaining: 0, utilization: "100.0%", stage: "FULL", flags: [], productKey: "WHOLE-LIFE-20Y" });
    expect(l.items[1]).toMatchObject({ remaining: 150_000, utilization: "85.0%", stage: "WARN", flags: ["OVERDUE"] });
    expect((await ok("/api/v1/me/limits?status=WARN", one)).items.map((x: any) => x.ledgerId)).toEqual(["l-POL-2026-0002"]);
    expect((await ok("/api/v1/me/limits?status=CRIT", one)).items).toEqual([]);
  });

  it("한도 상세: 이력은 그 원장의 것만 source_seq 순(설계사 열 없는 표 — 소유 원장 부분 질의)", async () => {
    const d = await ok("/api/v1/me/limits/1", one);
    expect(d.history.map((h: any) => [h.sourceSeq, h.kind, h.accumAfter])).toEqual([
      [10, "POST", 1_000_000],
      [11, "POST", 1_800_000],
    ]);
    expect(d.explanation).toBeNull();
  });
});

describe("계약 검증기 자체 검사", () => {
  it("덧붙인 필드·틀린 형식을 거부한다", () => {
    expect(validate("Problem", { code: "NOT_FOUND", message: "x", extra: 1 })).not.toEqual([]);
    expect(validate("MeResponse", { asOf: { seq: 1 }, dataStatus: "OK", agentId: "A", role: "AGENT", tenant: { name: "x", payoutDayRule: "x", limitWarnBp: 1, limitCritBp: 1 }, disclaimer: "가상 데모 데이터 · 설계사 참고용 · 비확정 · 고객 제시 불가" })).not.toEqual([]);
  });
});
