// GroundingVerifier 단위 시험(설계서 §13 그라운딩 검증기 행, PHASES Phase 3 항목 1 — 40건 이상, LLM 0).
// 컨텍스트는 부록 A-1 정본 값(월납 150,000·한도 1,800,000·FY 945,000·시책 855,000 + 삭감 145,000·환수 −720,000).
import { describe, expect, it } from "vitest";
import {
  canonical,
  contextKeys,
  contextNumbers,
  DerivedNumbers,
  extractTokens,
  forbiddenViolations,
  gateExplanation,
  GroundingVerifier,
  type Json,
  koreanAmount,
  unknownCitedFields,
} from "../src/index.ts";

const A1: Json = {
  line: { calcId: "2", closeYm: "202608", commType: "INCENTIVE", amount: 855000, limitCutAmt: 145000, limitCutPolicy: "DEFER_AFTER_FY", policyMasked: "***0001" },
  basis: { rate: "1", ruleVersionIds: ["COMM_RATE:FY_COMM/inst=null:rateId=1001,v=1"] },
  policySummary: { contractDate: "2026-08-01", monthlyPremium: 150000 },
  ledger: { limitAmount: 1800000, limitMultiple: "12", accumPaid: 1080000 },
  limitPosting: { accumAfter: 1800000, limitAfter: 1800000, occurredAt: "2026-08-01T00:00:00Z" },
  clawback: { amount: -720000, closeYm: "202702", installmentNo: 7, payoutRate: "0.9" },
  month: { gross: 1800000, withholdingTax: 59400, net: 1740600 },
  derived: {
    requested: DerivedNumbers.requested(855000, 145000),
    remaining: DerivedNumbers.remaining(1800000, 1080000),
    utilization: DerivedNumbers.utilization(1080000, 1800000)!,
    fyUtilization: DerivedNumbers.utilization(945000, 1800000)!,
    utilizationAtPosting: DerivedNumbers.utilization(1800000, 1800000)!,
    grossDelta: DerivedNumbers.delta(0, 1800000),
  },
  deferrals: [{ dueYm: "202701", amount: 200000, status: "SCHEDULED" }],
};

const pass = (text: string, ctx: Json = A1) => GroundingVerifier.verify(text, ctx);
const missingOf = (text: string, ctx: Json = A1) => pass(text, ctx).missing;

describe("정규화: 한국어 금액 표현", () => {
  it.each([
    ["945,000원", "945000"],
    ["945000원", "945000"],
    ["94만 5천 원", "945000"],
    ["94만5천원", "945000"],
    ["0.945백만 원", "945000"],
    ["180만 원", "1800000"],
    ["2천5백만 원", "25000000"],
    ["1억 2천만 원", "120000000"],
    ["5천 원", "5000"],
    ["-720,000원", "720000"],
    ["−72만 원", "720000"],
  ])("%s → %s", (raw, value) => {
    const t = extractTokens(raw);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ kind: "number", value });
  });

  it("koreanAmount: 만 단위 섹션 합", () => {
    expect(koreanAmount("85만 5천")).toBe("855000");
    expect(koreanAmount("14만 5천")).toBe("145000");
  });

  it("canonical: 앞 0·소수 끝 0 제거, 부호 제거", () => {
    expect(canonical("052.50")).toBe("52.5");
    expect(canonical("100.0")).toBe("100");
    expect(canonical("-1,800,000")).toBe("1800000");
  });
});

describe("정규화: 비율·회차·날짜", () => {
  it("52.5%·52.5 퍼센트는 같은 비율 토큰", () => {
    expect(extractTokens("52.5%")[0]).toMatchObject({ kind: "percent", value: "52.5" });
    expect(extractTokens("52.5 퍼센트")[0]).toMatchObject({ kind: "percent", value: "52.5" });
  });
  it("100.0%와 100%는 같은 값", () => {
    expect(extractTokens("100.0%")[0]!.value).toBe(extractTokens("100%")[0]!.value);
  });
  it("7회차는 정수 7", () => {
    expect(extractTokens("7회차 환수")[0]).toMatchObject({ kind: "number", value: "7" });
  });
  it("2027년 2월은 월 202702", () => {
    expect(extractTokens("2027년 2월에")[0]).toMatchObject({ kind: "month", value: "202702" });
  });
  it("202708은 월 토큰", () => {
    expect(extractTokens("지급 예정월 202708")[0]).toMatchObject({ kind: "month", value: "202708" });
  });
  it("2026-08-01과 2026년 8월 1일은 같은 날짜", () => {
    expect(extractTokens("2026-08-01")[0]).toMatchObject({ kind: "date", value: "2026-08-01" });
    expect(extractTokens("2026년 8월 1일")[0]).toMatchObject({ kind: "date", value: "2026-08-01" });
  });
  it("2026-08은 월, 8월은 달 번호", () => {
    expect(extractTokens("2026-08")[0]).toMatchObject({ kind: "month", value: "202608" });
    expect(extractTokens("8월 시책")[0]).toMatchObject({ kind: "monthOfYear", value: "8" });
  });
  it("12개월·월납은 달 토큰이 아니다", () => {
    expect(extractTokens("12개월")[0]).toMatchObject({ kind: "number", value: "12" });
    expect(extractTokens("월납 150,000원")[0]).toMatchObject({ kind: "number", value: "150000" });
  });
});

describe("보이지 않는 문자·전각 숫자", () => {
  it("U+200B로 숫자를 쪼개도 하나의 토큰으로 본다", () => {
    expect(extractTokens("8\u200B55,000원")[0]).toMatchObject({ kind: "number", value: "855000" });
  });
  it("전각 숫자는 반각으로", () => {
    expect(extractTokens("８５５，０００원")[0]).toMatchObject({ kind: "number", value: "855000" });
  });
});

describe("제외 패턴(설계서 §6.1 4)", () => {
  it("조항 번호는 토큰이 아니다", () => {
    expect(extractTokens("가상 사규 제12조에 따라")).toEqual([]);
    expect(extractTokens("제7조의2 제1항")).toEqual([]);
  });
  it("순번은 토큰이 아니다", () => {
    expect(extractTokens("2번째 전기")).toEqual([]);
  });
  it("목록 머리 번호는 토큰이 아니다", () => {
    expect(extractTokens("1. 한도 초과\n2. 이연")).toEqual([]);
  });
  it("생성 ID·규칙 버전 ID 안의 숫자는 토큰이 아니다", () => {
    expect(extractTokens("라인 c-A1003-07-2, 원장 l-A1003-16")).toEqual([]);
    expect(extractTokens("COMM_RATE:FY_COMM/inst=null:rateId=1001,v=1")).toEqual([]);
  });
  it("상품 키·유형 코드 안의 숫자는 토큰이 아니다(CHILD-30Y·WHOLE-LIFE-20Y)", () => {
    expect(extractTokens("CHILD-30Y 상품의 FY_COMM 라인, WHOLE-LIFE-20Y")).toEqual([]);
  });
  it("증권번호 뒷자리는 마스킹 값과 대조한다", () => {
    expect(missingOf("***0001 계약")).toEqual([]);
    expect(missingOf("***0002 계약")).toEqual(["***0002"]);
  });
});

describe("판정: A-1 컨텍스트(부록 A-01·A-03·A-06)", () => {
  it("A-01 지급 855,000 · 한도 초과 145,000 · 요청 1,000,000(파생) · 한도 1,800,000 → PASS", () => {
    const r = pass("8월 시책은 요청 1,000,000원 중 855,000원이 지급되었고, 145,000원은 한도 1,800,000원을 넘어 빠졌습니다.");
    expect(r.status).toBe("PASS");
  });
  it("같은 사실을 만 단위로 써도 PASS", () => {
    expect(pass("시책 100만 원 중 85만 5천 원이 지급되고 14만 5천 원이 한도로 빠졌습니다.").status).toBe("PASS");
  });
  it("오답 유도 숫자 200,000은 S에 없어 FAIL(부록 A-12)", () => {
    // 200,000은 다른 계약의 분급액으로 컨텍스트에 있지 않게 별도 컨텍스트에서
    const ctx: Json = { line: { amount: 855000, limitCutAmt: 145000 } };
    const r = pass("한도로 깎인 금액은 200,000원입니다.", ctx);
    expect(r.status).toBe("FAIL");
    expect(r.missing).toEqual(["200,000"]);
  });
  it("근사어가 붙어도 검사한다 — 약 85만 원은 FAIL", () => {
    expect(missingOf("약 85만 원이 지급되었습니다.")).toEqual(["85만"]);
  });
  it("대략 145,000원은 값이 맞으면 PASS", () => {
    expect(pass("대략 145,000원이 이연되었습니다.").status).toBe("PASS");
  });
  it("소진율 100.0%(파생 utilizationAtPosting) PASS, 99%는 FAIL", () => {
    expect(pass("둘째 전기 뒤 소진율이 100%가 되었습니다.").status).toBe("PASS");
    expect(missingOf("소진율 99%")).toEqual(["99%"]);
  });
  it("소진율 52.5% — 컨텍스트에 있으면 PASS", () => {
    const ctx: Json = { derived: { utilization: DerivedNumbers.utilization(945000, 1800000)! } };
    expect(DerivedNumbers.utilization(945000, 1800000)).toBe("52.5%");
    expect(pass("FY 전기 뒤 소진율은 52.5%입니다.", ctx).status).toBe("PASS");
  });
  it("지급률 0.9는 90%로 써도 PASS", () => {
    expect(pass("지급률 90%가 적용되었습니다.").status).toBe("PASS");
  });
  it("잔여 720,000(파생 remaining) PASS", () => {
    expect(pass("한도 잔여는 72만 원입니다.").status).toBe("PASS");
  });
  it("환수 −720,000은 부호 없이 써도 PASS", () => {
    expect(pass("2027년 2월 7회차에 720,000원이 환수되었습니다.").status).toBe("PASS");
  });
  it("전월 대비 차이(파생 grossDelta) 1,800,000 감소 PASS", () => {
    expect(pass("총액이 전월보다 1,800,000원 줄었습니다.").status).toBe("PASS");
  });
  it("원천세·실수령 PASS", () => {
    expect(pass("원천세 59,400원을 뺀 1,740,600원이 지급되었습니다.").status).toBe("PASS");
  });
  it("배수 12와 월납 150,000 PASS", () => {
    expect(pass("한도는 월납 15만 원의 12배입니다.").status).toBe("PASS");
  });
  it("컨텍스트에 없는 지급 예정월 202708은 FAIL(부록 A-02)", () => {
    expect(missingOf("이연분은 202708에 지급됩니다.")).toEqual(["202708"]);
  });
  it("날짜는 월 단위 일치 허용: 2027년 1월 15일 ↔ 202701", () => {
    expect(pass("2027년 1월 15일에 분급분이 나옵니다.").status).toBe("PASS");
  });
  it("2026년 8월·8월 1일 PASS, 9월 1일은 FAIL", () => {
    expect(pass("2026년 8월 1일 체결, 8월 1일 전기").status).toBe("PASS");
    expect(missingOf("9월 1일 전기")).toEqual(["9월 1일"]);
  });
  it("없는 해 2025년은 FAIL", () => {
    expect(missingOf("2025년부터")).toEqual(["2025년"]);
  });
  it("숫자가 없는 문장은 PASS", () => {
    expect(pass("이 라인은 한도 규칙에 따라 일부가 이연되었습니다.").status).toBe("PASS");
  });
  it("실패 토큰을 모두 돌려준다", () => {
    expect(missingOf("300,000원과 400,000원")).toEqual(["300,000", "400,000"]);
  });
});

describe("numbersUsed 자기 신고도 S 안이어야 한다(§5.4 두 번째 불변식)", () => {
  it("신고 숫자가 컨텍스트에 있으면 PASS", () => {
    expect(GroundingVerifier.verify("설명", A1, { numbersUsed: [855000, "145000", "202608", "100%"] }).status).toBe("PASS");
  });
  it("신고 숫자 하나가 없으면 FAIL", () => {
    expect(GroundingVerifier.verify("설명", A1, { numbersUsed: [855000, 123456] }).missing).toEqual(["numbersUsed:123456"]);
  });
  it("extra 허용값은 S에 더해진다", () => {
    expect(GroundingVerifier.verify("10일에 지급", A1, { extra: ["2026-09-10"] }).status).toBe("PASS");
  });
});

describe("G5 인용 필드", () => {
  it("컨텍스트 경로·접두·배열 표기 모두 인정", () => {
    expect(unknownCitedFields(["line.amount", "line.limitCutAmt", "deferrals[0].dueYm", "deferrals[].amount", "derived", "ledger"], A1)).toEqual([]);
  });
  it("없는 필드는 돌려준다", () => {
    expect(unknownCitedFields(["line.payDate", "deferrals[3].amount"], A1)).toEqual(["line.payDate", "deferrals[3].amount"]);
  });
  it("contextKeys는 모든 접두를 담는다", () => {
    const k = contextKeys(A1);
    expect(k.has("deferrals.0.status")).toBe(true);
    expect(k.has("deferrals.0")).toBe(true);
  });
});

describe("G6 금지어·식별자", () => {
  it("금지 표현", () => {
    expect(forbiddenViolations("지급이 확정되었습니다")).toEqual(["PHRASE:확정"]);
    expect(forbiddenViolations("수익을 보장합니다")).toEqual(["PHRASE:보장"]);
    expect(forbiddenViolations("고객에게 안내하세요")).toEqual(["PHRASE:고객에게 안내"]);
  });
  it("다른 설계사 ID는 위반, 자기 ID는 허용", () => {
    expect(forbiddenViolations("A-1001 설계사의 라인", { ownAgentId: "A-1001" })).toEqual([]);
    expect(forbiddenViolations("A-1002 설계사와 비교", { ownAgentId: "A-1001" })).toEqual(["AGENT_ID:A-1002"]);
  });
  it("증권번호 원문은 위반", () => {
    expect(forbiddenViolations("POL-2026-0001 계약")).toEqual(["POLICY_NO:POL-2026-0001"]);
  });
  it("실존 보험사명은 위반", () => {
    expect(forbiddenViolations("삼성생명 상품")).toEqual(["INSURER:삼성생명"]);
  });
});

describe("gateExplanation: G4·G5·G6 합본", () => {
  it("셋 다 통과하면 PASS", () => {
    const r = gateExplanation({ text: "855,000원이 지급되었습니다.", citedFields: ["line.amount"], numbersUsed: [855000] }, A1, { ownAgentId: "A-1001" });
    expect(r).toEqual({ status: "PASS", g4: [], g5: [], g6: [] });
  });
  it("하나라도 걸리면 FAIL과 사유", () => {
    const r = gateExplanation({ text: "확정 금액 900,000원", citedFields: ["line.nope"], numbersUsed: [] }, A1);
    expect(r.status).toBe("FAIL");
    expect(r.g4).toEqual(["900,000"]);
    expect(r.g5).toEqual(["line.nope"]);
    expect(r.g6).toEqual(["PHRASE:확정"]);
  });
});

describe("contextNumbers: 컨텍스트 → S", () => {
  it("ISO 시각에서 날짜·월·연·일을 뽑는다", () => {
    const s = contextNumbers({ at: "2026-09-10T00:30:00Z" });
    expect([...s.dates]).toEqual(["2026-09-10"]);
    expect(s.months.has("202609") && s.years.has("2026") && s.days.has("10") && s.monthOfYears.has("9")).toBe(true);
  });
  it("소진율 문자열은 비율, 마스킹 증권번호는 뒷자리", () => {
    const s = contextNumbers({ u: "52.5%", p: "***0001" });
    expect(s.percents.has("52.5")).toBe(true);
    expect(s.policyTails.has("0001")).toBe(true);
  });
  it("ID 문자열 안의 숫자는 S에 넣지 않는다", () => {
    const s = contextNumbers({ calcId: "c-A1003-07-2", ledgerId: "l-A1003-16" });
    expect(s.numbers.size).toBe(0);
  });
});
