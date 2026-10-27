// VCR(실호출 녹화) 재생과 수기 픽스처 폴백(설계서 v0.1.3 §12 Phase 1 VCR 규칙).
// --stub: vcr/<name>.json이 있으면 그것만 쓴다(요청 해시가 다르면 오류 — 프롬프트가 바뀌면 다시 녹화).
//         vcr/<name>.json이 없을 때만 fixtures/<name>.fixture.json(수기)으로 폴백하고 경고를 남긴다. 수기 픽스처는 "녹화"가 아니다.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PROVIDERS = import.meta.dirname;

export interface VcrEntry {
  /** 첫 요청(처음 지시 1개 메시지)의 해시. 재생은 이 값으로 대조한다. */
  requestHash: string;
  /** 의미 검사 거부 뒤 plan_repair로 다시 물은 횟수(0이면 첫 응답). */
  repairs: number;
  model: string;
  recordedAt: string;
  usage: unknown;
  response: unknown;
}

export interface VcrFile {
  kind: "vcr";
  name: string;
  entries: Record<string, VcrEntry>;
}

export interface FixtureFile {
  kind: "fixture(수기)";
  name: string;
  note: string;
  entries: Record<string, unknown>;
}

export function canonicalHash(body: object): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export function vcrPath(name: string): string {
  return join(PROVIDERS, "vcr", `${name}.json`);
}

export function fixturePath(name: string): string {
  return join(PROVIDERS, "fixtures", `${name}.fixture.json`);
}

export type StubSource = { kind: "vcr"; file: VcrFile } | { kind: "fixture(수기)"; file: FixtureFile };

export function openStub(name: string): StubSource {
  if (existsSync(vcrPath(name))) return { kind: "vcr", file: JSON.parse(readFileSync(vcrPath(name), "utf8")) as VcrFile };
  if (existsSync(fixturePath(name))) {
    console.warn(`[stub] ${name}: vcr/${name}.json 없음 → fixtures/${name}.fixture.json(수기 픽스처, 녹화 아님)으로 폴백`);
    return { kind: "fixture(수기)", file: JSON.parse(readFileSync(fixturePath(name), "utf8")) as FixtureFile };
  }
  throw new Error(`[stub] ${name}: vcr·fixture 둘 다 없음`);
}

export function replay(src: StubSource, label: string, requestHash: string): unknown {
  if (src.kind === "vcr") {
    const e = src.file.entries[label];
    if (!e) throw new Error(`[stub] vcr ${src.file.name}: ${label} 녹화 없음 — 다시 녹화(--record)`);
    if (e.requestHash !== requestHash) throw new Error(`[stub] vcr ${src.file.name}: ${label} 요청 해시 불일치(프롬프트·스키마 변경) — 다시 녹화(--record)`);
    return e.response;
  }
  const r = src.file.entries[label];
  if (r === undefined) throw new Error(`[stub] fixture ${src.file.name}: ${label} 없음`);
  return r;
}

export function writeVcr(name: string, entries: Record<string, VcrEntry>): void {
  const file: VcrFile = { kind: "vcr", name, entries };
  writeFileSync(vcrPath(name), `${JSON.stringify(file, null, 2)}\n`);
}
