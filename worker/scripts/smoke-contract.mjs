// Phase 2·3 증거용: 실행 중인 Worker(기본 wrangler dev :8787 — 로컬 D1 활성 스트림)의 데모 설계사 3명 × 모든 조회 응답을
// 상위 계약 + copilot-overlay.json(설계서 v0.1.12 §7)으로 검증한다. 사용: node scripts/smoke-contract.mjs [기준 URL]
import { readFileSync } from "node:fs";
import { Validator } from "@cfworker/json-schema";
import { parse } from "yaml";
const doc = parse(readFileSync(new URL("../../contracts/api/v1/portal-api.openapi.yaml", import.meta.url), "utf8"));
const ov = JSON.parse(readFileSync(new URL("../../contracts/api/v1/copilot-overlay.json", import.meta.url), "utf8"));
const S = doc.components.schemas;
Object.assign(S, ov.replaceSchemas, ov.addSchemas);
const add = (n, e) => { S[n].properties = { ...S[n].properties, ...e.properties }; S[n].required = [...(S[n].required ?? []), ...(e.required ?? [])]; };
for (const n of ov.responses) add(n, ov.addToEveryResponse);
for (const [n, e] of Object.entries(ov.addTo)) add(n, e);
const vals = {};
const POL = /POL-\d{4}-\d{4,5}/;
const check = (name, body, where) => { if (POL.test(JSON.stringify(body))) errors.push([where, "증권번호 패턴(설계서 v0.1.13)"]); vals[name] ??= new Validator({ $ref: `#/components/schemas/${name}`, components: { schemas: S } }, "2020-12", false); const r = vals[name].validate(body); if (!r.valid) { errors.push([where, r.errors.slice(-2).map((e) => `${e.instanceLocation} ${e.error}`)]); } count[name] = (count[name] ?? 0) + 1; };
const errors = []; const count = {}; const B = process.argv[2] ?? "http://localhost:8787";
let drift = 0; const stages = {}; const expl = {};
const tallyExpl = (kind, e) => { const k = `${kind}:${e === null ? "null" : e.groundingStatus}`; expl[k] = (expl[k] ?? 0) + 1; };
const cards = await (await fetch(`${B}/api/v1/demo/agents`)).json(); check("DemoAgentsResponse", cards, "agents");
console.log(cards.items.map((c) => `${c.demoNo} ${c.agentName} ${c.grade} ${c.orgPath} ${c.contractCount} ${c.cardLabel}`).join("\n"));
for (const n of [1, 2, 3]) {
  const s = await fetch(`${B}/api/v1/demo/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ demoAgent: n }) });
  const cookie = s.headers.get("set-cookie").split(";")[0];
  const g = async (p, name) => { const r = await fetch(B + p, { headers: { Cookie: cookie } }); const b = await r.json(); if (r.status !== 200) errors.push([p, r.status, b]); else check(name, b, p); return b; };
  const me = await g("/api/v1/me", "MeResponse");
  const list = await g(`/api/v1/me/earnings?from=${me.months.from}&to=${me.months.to}`, "EarningsResponse");
  let lines = 0;
  for (const m of list.items) {
    if (m.monthDataStatus !== "OK") drift++;
    await g(`/api/v1/me/earnings/${m.closeYm}`, "MonthResponse");
    tallyExpl("MONTH_DIFF", (await g(`/api/v1/me/earnings/${m.closeYm}/diff`, "MonthDiffResponse")).explanation);
    for (let page = 0; ; page++) {
      const p = await g(`/api/v1/me/earnings/${m.closeYm}/lines?page=${page}&size=200`, "LinesResponse");
      for (const l of p.items) { tallyExpl("LINE", (await g(`/api/v1/me/earnings/lines/${encodeURIComponent(l.calcId)}`, "LineDetailResponse")).explanation); lines++; }
      if ((page + 1) * 200 >= p.total) break;
    }
  }
  const lim = await g("/api/v1/me/limits", "LimitsResponse");
  for (const l of lim.items) { stages[l.stage] = (stages[l.stage] ?? 0) + 1; tallyExpl("LIMIT", (await g(`/api/v1/me/limits/${encodeURIComponent(l.ledgerId)}`, "LimitDetailResponse")).explanation); }
  console.log(`demo ${n} ${me.agentId}: months ${list.items.length} (${me.months.from}..${me.months.to}) lines ${lines} ledgers ${lim.items.length}`);
}
console.log("validated", JSON.stringify(count), "drift", drift, "stages", JSON.stringify(stages));
console.log("explanations", JSON.stringify(Object.fromEntries(Object.entries(expl).sort())));
console.log("errors", errors.length, JSON.stringify(errors.slice(0, 5)));
