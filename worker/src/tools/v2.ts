// 툴 결과 v2(설계서 v0.1.44 §4.3.1): v1 결과에 코드 라벨(<필드>Label, 합계는 <키>Label 맵)과 인용 가능한 경로 틀(citable)을 붙인다.
// 코드는 그대로 둔다(경로 선택자 — byType.FY_COMM). 표에 없는 코드는 원문 대신 "미등록 사유"(합계 키는 경로라 그대로, 라벨만).
// 금액·숫자는 건드리지 않는다 — 라벨·경로 문자열만 더한다(G4 근거 집합이 v1과 같다).
import { type LabelField, labelOf, STABLE_KEYS, UNREGISTERED_LABEL } from "@copilot/grounding";
import type { ToolData } from "./result";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** 툴별 라벨 대상: 경로(최상위 키 또는 "목록[]" 원소의 키) → 라벨 표. */
const SCALAR: Readonly<Record<string, Readonly<Record<string, LabelField>>>> = {
  get_statement: { status: "monthStatus" },
  get_limit: {},
  get_deferrals: {},
  get_policy_event_sim: { reason: "simReason" },
};
const NESTED: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, LabelField>>>>>> = {
  get_statement: { lines: { commType: "commType", limitCutPolicy: "limitCutPolicy" } },
  get_limit: {
    ledger: { stage: "limitStage" },
    history: { kind: "historyKind", reason: "historyReason" },
    limitCuts: { commType: "commType", limitCutPolicy: "limitCutPolicy" },
    deferrals: { status: "deferralStatus", reason: "deferralReason" },
  },
  get_deferrals: { items: { status: "deferralStatus", reason: "deferralReason" } },
  get_policy_event_sim: {},
};
/** 코드를 키로 쓰는 합계 맵 → 키 라벨 표. */
const KEYED: Readonly<Record<string, Readonly<Record<string, LabelField>>>> = {
  get_statement: { byType: "commType" },
  get_limit: {},
  get_deferrals: { byStatus: "deferralStatus" },
  get_policy_event_sim: {},
};
/** 인용 틀에서 뺄 키(라벨·안내·식별자 그 자체). simulation은 모양이 정해져 있지 않아 통째로 하나. */
const NOT_CITABLE = new Set(["found", "citable", ...STABLE_KEYS]);

/** 객체의 코드 필드 옆에 라벨을 끼운다(키 순서: 코드 바로 뒤). 미등록 수를 센다. */
function labelFields(o: Obj, fields: Readonly<Record<string, LabelField>>, count: { n: number }): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(o)) {
    const f = fields[k];
    if (f && typeof v === "string") {
      const l = labelOf(f, v);
      if (!l.registered) count.n++;
      out[k] = l.code;
      out[`${k}Label`] = l.label;
    } else out[k] = v;
  }
  return out;
}

/** 인용 가능한 경로 틀 — "{a,b}" 는 그 자리의 키 묶음, 목록은 안정 키가 있으면 "[calcId=…]", 없으면 ".<n>". */
function citableOf(data: Obj, keyed: Readonly<Record<string, LabelField>>): string[] {
  const scalars: string[] = [];
  const out: string[] = [];
  const fieldsOf = (o: Obj) => Object.keys(o).filter((k) => !k.endsWith("Label") && !NOT_CITABLE.has(k));
  for (const [k, v] of Object.entries(data)) {
    if (k.endsWith("Label") || NOT_CITABLE.has(k)) continue;
    if (Array.isArray(v)) {
      const rows = v.filter(isObj);
      if (rows.length === 0) {
        if (v.length) out.push(`${k}.<n>`);
        continue;
      }
      const sk = STABLE_KEYS.find((s) => rows.every((r) => typeof r[s] === "string"));
      const fs = [...new Set(rows.flatMap(fieldsOf))];
      out.push(`${k}${sk ? `[${sk}=…]` : ".<n>"}.{${fs.join(",")}}`);
    } else if (isObj(v)) {
      if (k in keyed || k === "byMonth") out.push(`${k}.<키>`);
      else if (k === "simulation") out.push(k);
      else out.push(`${k}.{${fieldsOf(v).join(",")}}`);
    } else scalars.push(k);
  }
  return [...(scalars.length ? [`{${scalars.join(",")}}`] : []), ...out];
}

/** v1 결과 → v2(라벨 + citable). 순수 함수 — fitList가 목록을 줄이며 여러 번 부른다. 미등록 수는 countUnregistered로 최종 결과에서 센다. */
export function toV2(tool: string, data: ToolData): ToolData {
  const count = { n: 0 };
  let d = labelFields(data, SCALAR[tool] ?? {}, count);
  for (const [k, fields] of Object.entries(NESTED[tool] ?? {})) {
    const v = d[k];
    if (Array.isArray(v)) d = { ...d, [k]: v.map((x) => (isObj(x) ? labelFields(x, fields, count) : x)) };
    else if (isObj(v)) d = { ...d, [k]: labelFields(v, fields, count) };
  }
  const keyed = KEYED[tool] ?? {};
  const withKeyLabels: Obj = {};
  for (const [k, v] of Object.entries(d)) {
    withKeyLabels[k] = v;
    const f = keyed[k];
    if (f && isObj(v)) {
      withKeyLabels[`${k}Label`] = Object.fromEntries(
        Object.keys(v).map((code) => {
          const l = labelOf(f, code);
          return [code, l.registered ? l.label : UNREGISTERED_LABEL];
        }),
      );
    }
  }
  return { ...withKeyLabels, citable: citableOf(withKeyLabels, keyed) };
}

/** 최종 결과의 미등록 라벨 수(…Label 문자열과 …Label 맵의 값). stat:label:unregistered에 더한다. */
export function countUnregistered(v: unknown): number {
  if (Array.isArray(v)) return v.reduce((n: number, x) => n + countUnregistered(x), 0);
  if (!isObj(v)) return 0;
  let n = 0;
  for (const [k, x] of Object.entries(v)) {
    if (k.endsWith("Label")) {
      if (x === UNREGISTERED_LABEL) n++;
      else if (isObj(x)) n += Object.values(x).filter((y) => y === UNREGISTERED_LABEL).length;
    } else n += countUnregistered(x);
  }
  return n;
}
