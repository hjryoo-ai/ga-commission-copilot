// 가상 사규집 "데모GA 수수료 규정" 40조항의 계획(설계서 §4.1(c), PHASES Phase 4 항목 1).
// 조항 번호·제목·공개 범위·다룰 내용·사실값(facts)은 코드가 정하고, LLM은 facts의 값만 써서 본문 문장을 쓴다 — 본문 숫자는 G4로 facts에 묶인다(규약 1).
// 사실값은 데모 세계의 엔진 대역(world/rules/tables.ts)에서 가져오고, 엔진에 없는 절차 수치(이의제기 기한 등)만 아래 RULEBOOK_ONLY에 둔다 — 전부 가상 예시값.
import type { Json } from "@copilot/grounding";
import { CAMPAIGNS, CLOCK, CONTRACT_FROM, CURVE, CURVE_FROM, LIMIT_FROM, LIMIT_MULTIPLE, PAYOUT_RATE, PRODUCTS, WITHHOLDING_RATE } from "../world/rules/tables.ts";

export type Visibility = "agent" | "internal";

export interface ArticlePlan {
  no: number;
  chapter: string;
  title: string;
  /** internal = 요율표 조항 — 런타임 검색에서 뺀다(설계서 §2.3·§4.1(c)). */
  visibility: Visibility;
  /** 본문이 다룰 내용(숫자 없이 — 숫자는 facts에만). */
  points: string[];
  /** 본문에 쓸 수 있는 값. 키가 Day·Days로 끝나면 "N일"(기간·날)로 쓸 수 있다(gate.ts). */
  facts: Json;
}

/** 엔진에 없는 절차 수치(사규집 전용 가상 예시값 — 엔진 계산에 쓰지 않는다). */
export const RULEBOOK_ONLY = { objectionDays: 30, objectionReplyDays: 14, recordYears: 5 } as const;

/** 한도 경고 단계(상위 LimitStage — 데모 테넌트 설정 limitWarnBp 8000·limitCritBp 9500, worker/src/api/me.ts·gen/explain/context.ts와 같은 값). */
const STAGE = { warn: "80%", crit: "95%", full: "100%" } as const;

const PRODUCT_LABEL: Readonly<Record<string, string>> = {
  "WHOLE-LIFE-20Y": "종신(20년납)",
  "TERM-10Y": "정기(10년납)",
  "HEALTH-100": "건강(100세 만기)",
  "ANNUITY-10Y": "연금(10년납)",
  "CHILD-30Y": "어린이(30년 만기)",
};

const GRADE_LABEL: Readonly<Record<string, string>> = { SR: "선임", MR: "중견", JR: "신입" };

const CH = {
  general: "제1장 총칙",
  fee: "제2장 수수료의 종류와 산정",
  limit: "제3장 수수료 한도",
  curve: "제4장 분급",
  clawback: "제5장 환수와 상계",
  pay: "제6장 마감과 지급",
  misc: "제7장 이의제기와 보칙",
} as const;

export const ARTICLES: readonly ArticlePlan[] = [
  { no: 1, chapter: CH.general, title: "목적", visibility: "agent", points: ["이 규정은 데모GA가 소속 설계사에게 지급하는 수수료의 종류·산정·한도·분급·환수·지급 절차를 정한다", "이 규정은 데모용 가상 규정이고 값은 예시값이다"], facts: { company: "데모GA" } },
  { no: 2, chapter: CH.general, title: "정의", visibility: "agent", points: ["용어의 뜻을 항목별로 정의한다: 초년도 수수료, 유지 수수료, 시책, 수수료 한도, 소진율, 분급, 환수, 환수 채권, 상계, 마감, 지급일"], facts: { terms: ["초년도 수수료", "유지 수수료", "시책", "수수료 한도", "소진율", "분급", "환수", "환수 채권", "상계", "마감", "지급일"] } },
  { no: 3, chapter: CH.general, title: "적용 범위", visibility: "agent", points: ["시행일 이후 체결된 보험 계약에서 생기는 수수료에 적용한다", "개별 조항에 따로 정한 적용 시기가 있으면 그 조항을 따른다"], facts: { effectiveFrom: CONTRACT_FROM } },
  { no: 4, chapter: CH.general, title: "명세와 규정의 관계", visibility: "agent", points: ["실제 금액은 정산 엔진이 계산한 수수료 명세가 기준이다", "이 규정은 명세 항목의 뜻을 설명하기 위한 것이며, 규정 문구만으로 개별 금액을 계산하지 않는다"], facts: {} },
  { no: 5, chapter: CH.fee, title: "수수료의 종류", visibility: "agent", points: ["수수료 명세의 항목 종류를 나열하고 각각을 한 문장으로 설명한다: 초년도 수수료, 유지 수수료, 시책, 환수, 분급 지급분, 마감 후 정정"], facts: { kinds: ["초년도 수수료", "유지 수수료", "시책", "환수", "분급 지급분", "마감 후 정정"] } },
  { no: 6, chapter: CH.fee, title: "초년도 수수료", visibility: "agent", points: ["초년도 수수료는 월납 보험료에 상품별 초년도 요율과 설계사 등급별 지급률을 적용해 정산 엔진이 산정한다", "상품별 요율과 등급별 지급률은 내부 요율표로 관리하며 이 규정에 적지 않는다", "초년도 수수료는 수수료 한도의 적용 대상이다"], facts: {} },
  { no: 7, chapter: CH.fee, title: "유지 수수료", visibility: "agent", points: ["계약이 유지되면 정해진 회차부터 매월 유지 수수료를 지급한다", "유지 수수료 요율은 내부 요율표로 관리한다", "유지 수수료는 수수료 한도의 적용 대상이 아니다"], facts: { renewalFromInstallment: 13 } },
  { no: 8, chapter: CH.fee, title: "시책", visibility: "agent", points: ["회사가 정한 기간에 정한 상품을 체결하면 정액의 시책을 지급할 수 있다", "시책은 수수료 한도의 적용 대상이며, 한도를 넘는 부분은 제15조에 따라 처리한다", "시책 기간·대상 상품·금액은 내부 시책표로 관리한다"], facts: {} },
  {
    no: 9,
    chapter: CH.fee,
    title: "상품별 요율표",
    visibility: "internal",
    points: ["상품별 초년도 요율(월납 보험료의 배수)과 유지 수수료 요율(월납 보험료의 배수)을 표처럼 항목별로 적는다", "이 조항은 내부 관리용이다"],
    facts: { products: PRODUCTS.map((p) => ({ product: PRODUCT_LABEL[p.key]!, firstYearRate: p.fyRate, renewalRate: p.renewalRate })) },
  },
  { no: 10, chapter: CH.fee, title: "등급별 지급률표", visibility: "internal", points: ["설계사 등급별 지급률을 항목별로 적는다", "이 조항은 내부 관리용이다"], facts: { grades: Object.entries(PAYOUT_RATE).map(([g, r]) => ({ grade: GRADE_LABEL[g]!, payoutRate: r })) } },
  {
    no: 11,
    chapter: CH.fee,
    title: "시책표",
    visibility: "internal",
    points: ["시책 대상 월·상품·정액을 항목별로 적는다", "이 조항은 내부 관리용이다"],
    facts: { campaigns: CAMPAIGNS.map((c) => ({ month: c.ym, product: PRODUCT_LABEL[c.productKey]!, amount: c.amount })) },
  },
  { no: 12, chapter: CH.limit, title: "수수료 한도의 산정", visibility: "agent", points: ["계약별 수수료 한도는 월납 보험료에 배수를 곱한 금액으로 한다", "배수와 그 백분율 표기를 함께 적는다", "한도는 계약마다 한도 원장으로 관리한다"], facts: { limitMultiple: LIMIT_MULTIPLE, limitMultiplePercent: `${Number(LIMIT_MULTIPLE) * 100}%` } },
  { no: 13, chapter: CH.limit, title: "한도의 적용 시기", visibility: "agent", points: ["수수료 한도는 정해진 날짜 이후 체결된 계약부터 적용한다", "그 전에 체결된 계약에는 한도를 적용하지 않는다"], facts: { limitFrom: LIMIT_FROM } },
  { no: 14, chapter: CH.limit, title: "소진율과 경고 단계", visibility: "agent", points: ["소진율은 한도 대비 누적 지급액의 비율이다", "소진율에 따라 정상·주의·위험·소진 네 단계로 구분하고, 각 단계의 기준 비율을 적는다", "단계 표시는 안내용이며 지급액을 바꾸지 않는다"], facts: { warnFrom: STAGE.warn, critFrom: STAGE.crit, fullAt: STAGE.full } },
  { no: 15, chapter: CH.limit, title: "한도 초과분의 처리", visibility: "agent", points: ["한도를 넘는 수수료는 상품에 정한 방식에 따라 삭감하거나 초년도 종료 후로 이연한다", "삭감과 이연 중 어느 방식인지는 수수료 명세의 한도 삭감 정책 항목에 표시한다", "한도를 넘은 부분을 뺀 금액만 그 달에 지급한다"], facts: { policies: ["삭감", "초년도 종료 후 이연"] } },
  { no: 16, chapter: CH.limit, title: "이연분의 지급", visibility: "agent", points: ["초년도 종료 후 이연으로 처리된 금액의 지급 시점은 이 규정에서 정하지 않는다", "이연분의 지급 여부와 시점은 수수료 명세에 이연 항목으로 나타난 경우에만 확인할 수 있다", "명세에 이연 항목이 없으면 지급 시점은 데이터로 확인되지 않는다"], facts: {} },
  { no: 17, chapter: CH.limit, title: "한도의 재산정", visibility: "agent", points: ["감액 등으로 월납 보험료가 바뀌면 그 날짜에 한도를 다시 산정한다", "재산정 뒤 누적 지급액이 새 한도를 넘더라도 이미 지급한 금액은 이 조항만으로 회수하지 않는다", "재산정 내역은 한도 원장 이력에 남긴다"], facts: {} },
  { no: 18, chapter: CH.limit, title: "한도 원장", visibility: "agent", points: ["한도 원장은 계약별 한도·누적 지급액·소진율과 그 변동 이력을 기록한다", "이력은 전기(수수료 반영)·재산정·환수 반영의 종류와 각 이후의 누적·소진율을 담는다"], facts: {} },
  { no: 19, chapter: CH.curve, title: "분급의 적용 시기", visibility: "agent", points: ["분급은 정해진 날짜 이후 체결된 계약의 초년도 수수료에 적용한다", "그 전에 체결된 계약은 분급하지 않고 산정한 달에 지급한다"], facts: { curveFrom: CURVE_FROM } },
  {
    no: 20,
    chapter: CH.curve,
    title: "분급 비율과 시기",
    visibility: "agent",
    points: ["분급 대상 초년도 수수료는 일부를 산정한 달에 지급하고, 나머지는 정해진 개월 수가 지난 뒤 같은 비율로 나누어 지급한다", "첫 지급 비율, 이후 각 지급 비율, 각 지급까지의 개월 수를 적는다"],
    facts: { curveLabel: CURVE.label, firstShare: CURVE.firstShare, installmentShare: CURVE.installmentShare, installmentMonths: [...CURVE.installments] },
  },
  { no: 21, chapter: CH.curve, title: "분급의 지급 조건", visibility: "agent", points: ["분급 예정분은 지급 예정월에 계약이 유지 중이어야 지급한다", "조건을 충족하면 예정분을 지급 처리한다"], facts: {} },
  { no: 22, chapter: CH.curve, title: "분급의 보류", visibility: "agent", points: ["지급 예정월에 계약이 유지 중이 아니면 그 예정분은 보류한다", "보류한 예정분은 계약 상태가 확인될 때까지 지급하지 않는다"], facts: {} },
  { no: 23, chapter: CH.curve, title: "해약 시 분급의 취소", visibility: "agent", points: ["계약이 해약되거나 원 계약 수수료가 취소되면 아직 지급하지 않은 분급 예정분과 보류분은 취소한다", "이미 지급한 분급분의 환수는 제24조부터 제28조까지에 따른다"], facts: {} },
  { no: 24, chapter: CH.clawback, title: "환수 사유", visibility: "agent", points: ["계약이 정해진 회차를 채우지 못하고 해약·실효되면 이미 지급한 초년도 수수료의 일부를 환수한다", "환수는 해약이 반영된 달의 수수료 명세에 환수 항목으로 표시한다"], facts: {} },
  {
    no: 25,
    chapter: CH.clawback,
    title: "환수율",
    visibility: "agent",
    points: ["환수율은 해약 시점의 납입 회차 구간에 따라 다르다", "각 회차 구간과 환수율을 적고, 환수가 없는 회차를 적는다"],
    facts: { bands: [{ fromInstallment: 1, toInstallment: 6, rate: "0.7" }, { fromInstallment: 7, toInstallment: 12, rate: "0.4" }], noClawbackFromInstallment: 13 },
  },
  { no: 26, chapter: CH.clawback, title: "환수 금액", visibility: "agent", points: ["환수 금액은 해당 계약에서 이미 지급한 초년도 수수료에 환수율을 적용해 정산 엔진이 산정한다", "산정한 환수 금액은 수수료 명세의 환수 항목으로 확인한다"], facts: {} },
  { no: 27, chapter: CH.clawback, title: "상계 순서", visibility: "agent", points: ["환수 금액은 먼저 그 달 지급할 수수료와 상계한다", "그 달 수수료로 다 상계하지 못한 금액은 환수 채권으로 이월한다", "이월된 환수 채권은 이후 달의 지급 수수료에서 먼저 생긴 채권부터 차례로 상계한다"], facts: {} },
  { no: 28, chapter: CH.clawback, title: "환수 채권의 상태", visibility: "agent", points: ["환수 채권은 미회수, 일부 상계, 회수 종료의 세 상태로 관리한다", "잔액이 없어지면 회수 종료로 바꾼다"], facts: { states: ["미회수", "일부 상계", "회수 종료"] } },
  { no: 29, chapter: CH.pay, title: "마감", visibility: "agent", points: ["매월 수수료는 다음 달 정해진 날에 마감한다", "마감 전에는 잠정 명세를, 마감 후에는 확정된 명세를 보여 준다"], facts: { closeDay: CLOCK.closeDay } },
  { no: 30, chapter: CH.pay, title: "지급일", visibility: "agent", points: ["마감한 달의 수수료는 다음 달 정해진 날에 지급한다", "지급일이 휴일이면 회사가 따로 정한다"], facts: { payoutDay: CLOCK.payoutDay } },
  { no: 31, chapter: CH.pay, title: "원천징수", visibility: "agent", points: ["지급할 수수료에서 원천세를 공제한 금액을 실지급액으로 한다", "원천세율을 적는다"], facts: { withholdingRate: WITHHOLDING_RATE } },
  { no: 32, chapter: CH.pay, title: "잠정 명세", visibility: "agent", points: ["마감 전 명세는 잠정 명세이며 마감 때까지 바뀔 수 있다", "잠정 명세의 금액은 예상값으로 표시한다"], facts: {} },
  { no: 33, chapter: CH.pay, title: "마감월의 불변", visibility: "agent", points: ["마감한 달의 명세 항목과 합계는 바꾸지 않는다", "마감 후 바로잡을 내용은 다음 달 이후 명세에 정정 항목으로 반영한다"], facts: {} },
  { no: 34, chapter: CH.pay, title: "마감 후 정정", visibility: "agent", points: ["요율 정정 등 마감 후 정정 사유가 생기면 정정 항목을 만든다", "정정 항목에는 사유와 원 항목을 함께 표시한다"], facts: {} },
  { no: 35, chapter: CH.misc, title: "명세의 확인", visibility: "agent", points: ["설계사는 본인의 수수료 명세에서 항목별 금액과 산정 근거를 확인할 수 있다", "다른 설계사의 명세는 조회할 수 없다"], facts: {} },
  { no: 36, chapter: CH.misc, title: "이의제기", visibility: "agent", points: ["명세 내용에 이의가 있으면 지급일부터 정해진 기간 안에 이의를 제기할 수 있다", "이의제기에는 해당 명세 월과 항목을 적는다"], facts: { objectionDays: RULEBOOK_ONLY.objectionDays } },
  { no: 37, chapter: CH.misc, title: "이의제기의 처리", visibility: "agent", points: ["회사는 이의제기를 받은 날부터 정해진 기간 안에 처리 결과를 알린다", "이의가 받아들여지면 다음 달 이후 명세에 정정 항목으로 반영한다"], facts: { objectionReplyDays: RULEBOOK_ONLY.objectionReplyDays } },
  { no: 38, chapter: CH.misc, title: "자료의 보존", visibility: "agent", points: ["수수료 명세와 산정 근거 자료를 정해진 햇수 동안 보존한다"], facts: { recordYears: RULEBOOK_ONLY.recordYears } },
  { no: 39, chapter: CH.misc, title: "정보의 보호", visibility: "agent", points: ["설계사는 본인 데이터만 조회할 수 있다", "증권번호 등 계약 식별 정보는 뒷자리만 보이게 가려서 표시한다"], facts: {} },
  { no: 40, chapter: CH.misc, title: "시행일", visibility: "agent", points: ["이 규정은 effectiveFrom에 시행한다", "수수료 한도 조항(제12조부터 제18조까지)은 limitFrom 이후 체결된 계약부터 적용한다", "분급 조항(제19조부터 제23조까지)은 curveFrom 이후 체결된 계약부터 적용한다"], facts: { effectiveFrom: CONTRACT_FROM, limitFrom: LIMIT_FROM, curveFrom: CURVE_FROM } },
];

export const articleLabel = (no: number) => `제${no}조`;
