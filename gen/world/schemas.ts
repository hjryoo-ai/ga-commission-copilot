// contracts/ 전체를 Ajv 2020-12에 올린다(G1). 상위 봉투 스키마는 Ajv strictTypes를 지키지 않아 그 검사만 끈다(gen/test/contracts.test.ts와 같음).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";

export const CONTRACTS_DIR = join(import.meta.dirname, "../../contracts");

export const SCHEMA_IDS = {
  envelope: "https://ga.example/portal/contracts/events/v1/envelope.schema.json",
  plan: "https://ga.example/copilot/contracts/plan/v1/plan.schema.json",
  planLlm: "https://ga.example/copilot/contracts/plan/v1/plan-llm.schema.json",
} as const;

function schemaFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? schemaFiles(join(dir, e.name)) : e.name.endsWith(".schema.json") ? [join(dir, e.name)] : [],
  );
}

let ajv: Ajv2020 | undefined;

export function validator(id: string): ValidateFunction {
  if (!ajv) {
    ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
    for (const f of schemaFiles(CONTRACTS_DIR)) ajv.addSchema(JSON.parse(readFileSync(f, "utf8")) as object);
  }
  const v = ajv.getSchema(id);
  if (!v) throw new Error(`schema ${id} 없음`);
  return v;
}

export function schemaJson(relPath: string): object {
  return JSON.parse(readFileSync(join(CONTRACTS_DIR, "..", relPath), "utf8")) as object;
}

export function errorsOf(v: ValidateFunction): string {
  return (v.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join("; ");
}
