// 툴 결과 v2 라벨(설계서 v0.1.44 §4.3.2): 표는 labels.json 한 벌. 코드는 그대로 두고 옆에 라벨을 싣는다.
// 표에 없는 코드(열린 값 — commType·한도 이력 사유)는 원문 코드 대신 "미등록 사유"로 내보내고, 호출자가 센 수로 stat을 올린다.
import labels from "../labels.json" with { type: "json" };

export type LabelField = keyof typeof labels.fields;

export const LABEL_FIELDS = Object.keys(labels.fields) as LabelField[];
export const UNREGISTERED_LABEL: string = labels.unregistered;
export const NOT_EXPORTED: readonly string[] = labels.notExported;
export const DIFFERS_FROM_WEB: Readonly<Record<string, string>> = labels.differsFromWeb;

const TABLE = labels.fields as Readonly<Record<LabelField, Readonly<Record<string, string>>>>;

/** 그 필드의 라벨 표(코드 → 라벨). */
export const labelTable = (field: LabelField): Readonly<Record<string, string>> => TABLE[field];

/** 모든 필드의 등록 코드(시험·G6 대조용). */
export const labeledCodes = (): Set<string> => new Set(LABEL_FIELDS.flatMap((f) => Object.keys(TABLE[f])));

export interface Labeled {
  /** 내보낼 값 — 등록 코드면 원문 코드, 아니면 "미등록 사유". */
  code: string;
  label: string;
  registered: boolean;
}

/** 코드 하나 → {code, label}. 미등록이면 둘 다 "미등록 사유". */
export function labelOf(field: LabelField, code: string): Labeled {
  const label = TABLE[field][code];
  return label === undefined ? { code: UNREGISTERED_LABEL, label: UNREGISTERED_LABEL, registered: false } : { code, label, registered: true };
}
