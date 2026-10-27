import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

// Phase 1 항목 1: 상위 저장소 계약 복사본(contracts/events/v1, envelope-core) + 플랜 스키마.
const CONTRACTS = join(import.meta.dirname, "../../contracts");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function pinned(checksums: string, base: string): [string, string][] {
  return readFileSync(checksums, "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const [hash, path] = line.split(/\s+/);
      return [join(base, path!), hash!];
    });
}

const json = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
const schemaFiles = files(CONTRACTS).filter((f) => f.endsWith(".schema.json"));

function ajv(): Ajv2020 {
  // 상위 봉투 스키마는 2020-12로 유효하지만 Ajv strictTypes(properties 옆 type:"object")를 지키지 않는다. 복사본은 해시 고정이라 고치지 않고,
  // 모르는 키워드·형식 검사(strictSchema)는 유지한 채 strictTypes만 끈다.
  const a = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
  for (const f of schemaFiles) a.addSchema(json(f));
  return a;
}

describe("상위 계약 복사본은 해시가 고정되어 있다", () => {
  const events = pinned(join(CONTRACTS, "events/CHECKSUMS.upstream"), CONTRACTS);
  const shared = pinned(join(CONTRACTS, "shared/ga-disclosure/CHECKSUMS"), join(CONTRACTS, "shared/ga-disclosure"));

  it.each([...events, ...shared].map(([p, h]) => [relative(CONTRACTS, p), p, h]))("%s", (_, path, hash) => {
    expect(sha256(path)).toBe(hash);
  });

  it("events/v1 아래 파일은 전부 CHECKSUMS.upstream에 있다(누락·추가 없음)", () => {
    const listed = new Set(events.map(([p]) => p));
    expect(files(join(CONTRACTS, "events/v1")).filter((f) => !listed.has(f))).toEqual([]);
  });
});

describe("JSON Schema 2020-12 컴파일", () => {
  it.each(schemaFiles.map((f) => [relative(CONTRACTS, f), f]))("%s", (_, f) => {
    const id = json(f).$id as string;
    expect(ajv().getSchema(id)).toBeTypeOf("function");
  });
});

describe("상위 샘플 이벤트는 봉투 스키마를 통과한다", () => {
  const envelopeId = json(join(CONTRACTS, "events/v1/envelope.schema.json")).$id as string;
  const validate = ajv().getSchema(envelopeId)!;
  const samples = files(join(CONTRACTS, "events/v1/samples")).flatMap((f) =>
    f.endsWith(".jsonl")
      ? readFileSync(f, "utf8").trim().split("\n").map((l, i) => [`${relative(CONTRACTS, f)}#${i + 1}`, JSON.parse(l)])
      : [[relative(CONTRACTS, f), json(f)]],
  );

  it("샘플이 있다", () => expect(samples.length).toBeGreaterThan(0));
  it.each(samples)("%s", (_, event) => {
    expect(validate(event), JSON.stringify(validate.errors)).toBe(true);
  });
});

describe("플랜 스키마 v1", () => {
  const validate = () => ajv().getSchema("https://ga.example/copilot/contracts/plan/v1/plan.schema.json")!;
  const contract = {
    policyNo: "P-0001",
    agentId: "A0001",
    productKey: "PRD-A",
    contractDate: "2026-08-01",
    monthlyPremium: 300000,
    lifecycle: [{ ym: "202702", event: "CANCEL" }],
  };

  it("정상 플랜을 통과시킨다", () => {
    expect(validate()({ contracts: [contract] })).toBe(true);
  });

  it("금액 필드를 거부한다(LLM은 금액을 만들지 않는다)", () => {
    expect(validate()({ contracts: [{ ...contract, commissionAmount: 800000 }] })).toBe(false);
  });

  it("보험료 실수·잘못된 월·모르는 이벤트를 거부한다", () => {
    expect(validate()({ contracts: [{ ...contract, monthlyPremium: 300000.5 }] })).toBe(false);
    expect(validate()({ contracts: [{ ...contract, lifecycle: [{ ym: "202713", event: "CANCEL" }] }] })).toBe(false);
    expect(validate()({ contracts: [{ ...contract, lifecycle: [{ ym: "202702", event: "NEW" }] }] })).toBe(false);
  });
});
