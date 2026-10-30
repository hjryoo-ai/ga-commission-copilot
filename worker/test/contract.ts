// 응답 스키마(설계서 v0.1.12 §7): 상위 계약 사본(contracts/api/v1/portal-api.openapi.yaml, 해시 고정) + copilot-overlay.json을 합성한다.
// Workers 런타임은 문자열 코드 생성(Ajv)을 막으므로 @cfworker/json-schema(해석기)로 검증한다.
import { type OutputUnit, Validator } from "@cfworker/json-schema";
import { parse } from "yaml";
import overlay from "../../contracts/api/v1/copilot-overlay.json";
import upstream from "../../contracts/api/v1/portal-api.openapi.yaml?raw";

type Schema = { properties?: Record<string, unknown>; required?: string[]; [k: string]: unknown };

function compose(): Record<string, Schema> {
  const doc = parse(upstream) as { components: { schemas: Record<string, Schema> } };
  const schemas = doc.components.schemas;
  Object.assign(schemas, overlay.replaceSchemas, overlay.addSchemas);
  const add = (name: string, extra: { properties?: Record<string, unknown>; required?: string[] }) => {
    const s = schemas[name];
    if (!s) throw new Error(`overlay: 상위 계약에 ${name} 없음`);
    s.properties = { ...s.properties, ...extra.properties };
    s.required = [...(s.required ?? []), ...(extra.required ?? [])];
  };
  for (const name of overlay.responses) add(name, overlay.addToEveryResponse);
  for (const [name, extra] of Object.entries(overlay.addTo)) add(name, extra as Schema);
  return schemas;
}

export const SCHEMAS = compose();

export function validate(name: string, body: unknown): OutputUnit[] {
  if (!SCHEMAS[name]) throw new Error(`schema ${name} 없음`);
  const v = new Validator({ $ref: `#/components/schemas/${name}`, components: { schemas: SCHEMAS } } as never, "2020-12", false);
  const r = v.validate(body);
  return r.valid ? [] : r.errors;
}
