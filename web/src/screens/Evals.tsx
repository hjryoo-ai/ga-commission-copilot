// 화면 5 평가 리포트(설계서 §8-5, PHASES Phase 6 항목 5 — 공개, 세션 없음): 최근 런 4축 추이(라인), 런 목록, 부록 A n=3 분산(v0.1.37),
// 런 상세(실패 우선 케이스 표·유형별 통과·모델별 4축·rulesUnavailable 따로 — v0.1.40). 값은 GET /api/v1/evals 그대로 — 화면은 백분율 표기만 한다.
// 색: 4축 범주 색은 dataviz 기본 팔레트 1~4번(검증기 통과 — 흰 바탕 대비 3:1 미만 2색은 범례·끝 라벨·표 숫자로 보완, 색만으로 읽지 않게).
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { api, type EvalAxes, type EvalBucket, type EvalCase, type EvalRates, type EvalRunDetail, type EvalRunSummary, type EvalVariance } from "../api";
import { Link, paths } from "../router";
import { Footer, Status, useLoad } from "../ui";
import { PROVIDER_LABEL } from "./Budget";

type AxisKey = keyof EvalRates;
const AXES: readonly { key: AxisKey; label: string; color: string }[] = [
  { key: "grounding", label: "그라운딩", color: "#2a78d6" },
  { key: "refusal", label: "거부", color: "#eb6834" },
  { key: "tool", label: "툴", color: "#1baf7a" },
  { key: "content", label: "내용", color: "#eda100" },
];
const BUCKET_LABEL: Record<EvalBucket, string> = { line: "라인", limit: "한도", deferral: "분급", rule: "규정", refusal: "거부" };
const FAILURE_LABEL: Record<string, string> = { GROUNDING: "그라운딩", REFUSAL: "거부", TOOL: "툴", CONTENT: "내용", ERROR: "실행 오류" };

export const pct = (r: number | null | undefined) => (r === null || r === undefined ? "—" : `${Math.round(r * 10000) / 100}%`);
const axisCell = (a: { n: number; pass: number; rate: number | null }) => (a.n === 0 ? "—" : `${pct(a.rate)} (${a.pass}/${a.n})`);
const providerLabel = (p: string | null) => (p && p in PROVIDER_LABEL ? PROVIDER_LABEL[p as keyof typeof PROVIDER_LABEL] : (p ?? "—"));
const shortDate = (iso: string) => `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
const versions = (pv: Record<string, string>) => ["answer", "schema_hint"].map((k) => (pv[k] ? `${k} ${pv[k]}` : null)).filter(Boolean).join(" · ");

/** 4축 추이 라인(오래된 런 → 최근). y 0~100% 한 축, 2px 선, 8px 점, 끝에 직접 라벨, 가까운 런에 십자선·툴팁. */
export function TrendChart({ runs }: { runs: readonly EvalRunSummary[] }) {
  const pts = [...runs].reverse();
  const [hover, setHover] = useState<number | null>(null);
  // 컨테이너 폭을 재서 SVG를 실제 픽셀로 그린다(viewBox 축소로 글자가 작아지지 않게 — 휴대폰 폭에서도 11px)
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 220;
  const pad = { l: 40, r: 104, t: 12, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (pts.length === 1 ? iw / 2 : (i * iw) / (pts.length - 1));
  const y = (r: number) => pad.t + ih - r * ih;
  const onMove = (e: MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  };
  // 끝 라벨이 겹치지 않게 최소 간격 12px로 밀어 낸다
  const last = pts.length - 1;
  const ends = AXES.map((a) => ({ a, v: pts[last]?.rates[a.key] ?? null }))
    .filter((e) => e.v !== null)
    .sort((p, q) => (q.v as number) - (p.v as number));
  let prevY = -Infinity;
  const labelY = new Map<AxisKey, number>();
  for (const e of ends) {
    const yy = Math.max(y(e.v as number), prevY + 12);
    labelY.set(e.a.key, yy);
    prevY = yy;
  }
  const h = hover === null ? null : pts[hover]!;
  // x 라벨은 약 90px마다 하나(겹치지 않게), 마지막 런은 항상
  const every = Math.max(1, Math.ceil((90 * Math.max(1, pts.length - 1)) / iw));
  return (
    <figure className="trend" data-testid="evals-trend">
      <ul className="legend" aria-label="범례">
        {AXES.map((a) => (
          <li key={a.key}>
            <span className="swatch" style={{ background: a.color }} aria-hidden="true" />
            {a.label}
          </li>
        ))}
      </ul>
      <div className="trend-plot" ref={box}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`최근 ${pts.length}개 런의 4축 비율 추이 — 값은 아래 표에 있다`}>
          {[0, 0.5, 1].map((g) => (
            <g key={g}>
              <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} className="grid" />
              <text x={pad.l - 6} y={y(g) + 4} textAnchor="end" className="tick">
                {g * 100}%
              </text>
            </g>
          ))}
          {pts.map((p, i) => (i % every === 0 || i === last) && (i === last || last - i >= every) && (
            <text key={p.runId} x={x(i)} y={H - 8} textAnchor={pts.length === 1 ? "middle" : i === 0 ? "start" : i === last ? "end" : "middle"} className="tick">
              {shortDate(p.startedAt)}
              {rescoreTag(p.runId, p.trigger)}
            </text>
          ))}
          {h && <line x1={x(hover!)} x2={x(hover!)} y1={pad.t} y2={pad.t + ih} className="crosshair" />}
          {AXES.map((a) => {
            const seg = pts.map((p, i) => ({ i, v: p.rates[a.key] })).filter((s): s is { i: number; v: number } => s.v !== null);
            return (
              <g key={a.key}>
                {seg.length > 1 && <polyline fill="none" stroke={a.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={seg.map((s) => `${x(s.i)},${y(s.v)}`).join(" ")} />}
                {seg.map((s) => (
                  <circle key={s.i} cx={x(s.i)} cy={y(s.v)} r={4} fill={a.color} stroke="#ffffff" strokeWidth={2} />
                ))}
                {labelY.has(a.key) && (
                  <text x={W - pad.r + 8} y={labelY.get(a.key)! + 4} className="end-label">
                    {a.label} {pct(pts[last]!.rates[a.key])}
                  </text>
                )}
              </g>
            );
          })}
          <rect x={pad.l - 12} y={pad.t} width={iw + 24} height={ih} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </svg>
        {h && (
          <div className="tooltip" role="status" style={{ left: `${(x(hover!) / W) * 100}%`, transform: x(hover!) < W * 0.25 ? "none" : x(hover!) > W * 0.75 ? "translateX(-100%)" : "translateX(-50%)" }}>
            <strong>{h.runId}</strong>
            {AXES.map((a) => (
              <span key={a.key}>
                <span className="swatch" style={{ background: a.color }} aria-hidden="true" />
                {a.label} {pct(h.rates[a.key])}
              </span>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}

function RunsTable({ runs }: { runs: readonly EvalRunSummary[] }) {
  return (
    <div className="table-scroll">
<table className="budget evals-runs" data-testid="evals-runs">
      <thead>
        <tr>
          <th scope="col">런</th>
          <th scope="col">통과</th>
          {AXES.map((a) => (
            <th scope="col" key={a.key}>
              {a.label}
            </th>
          ))}
          <th scope="col">규정 검색 끔</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.runId}>
            <th scope="row">
              <Link to={paths.evalRun(r.runId)}>{r.runId}</Link>
              <span className="muted small note-line">
                {r.trigger} · {versions(r.promptVersions)} · {r.model}
              </span>
            </th>
            <td className="num">
              {r.passed}/{r.total}
            </td>
            {AXES.map((a) => (
              <td className="num" key={a.key}>
                {pct(r.rates[a.key])}
              </td>
            ))}
            <td className="num">{r.rulesUnavailable.total ? `${r.rulesUnavailable.passed}/${r.rulesUnavailable.total}` : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
</div>
  );
}

function VarianceTable({ v }: { v: EvalVariance }) {
  const n = v.runs.length;
  return (
    <>
      <p className="muted small">
        {versions(v.promptVersions)} · {n}/3런 · 분포{" "}
        {Object.entries(v.distribution)
          .sort(([a], [b]) => Number(b) - Number(a)) // 정수 키는 객체에서 오름차순이 된다 — 3/3부터 보이게
          .map(([k, c]) => `${k}/${n} ${c}건`)
          .join(" · ")}{" "}
        · {n}회 중 통과가 {n - 1}회 이하인 케이스는 answer/v4 1차 대상(설계서 v0.1.37)
      </p>
      <div className="table-scroll">
<table className="budget" data-testid="evals-variance">
        <thead>
          <tr>
            <th scope="col">케이스</th>
            {v.runs.map((r) => (
              <th scope="col" key={r.runId}>
                {r.trigger.replace("variance:", "")}
              </th>
            ))}
            <th scope="col">통과</th>
          </tr>
        </thead>
        <tbody>
          {v.cases.map((c) => (
            <tr key={c.caseId} className={c.n === n && c.passes < n ? "target" : undefined}>
              <th scope="row">
                {c.caseId}
                {c.question && <span className="muted small note-line">{c.question}</span>}
              </th>
              {c.results.map((x, i) => (
                <td key={i} className="num">
                  {x === null ? "—" : x ? "통과" : "실패"}
                </td>
              ))}
              <td className="num">
                {c.passes}/{c.n}
                {c.n === n && c.passes < n && <span className="small note-line">v4 대상</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
</div>
    </>
  );
}

/** 추이는 60문항 전체 런(기준선·주간·그 재채점)만 — PR 표본 20건·variance 12건·stub 런은 문항이 달라 같은 선에 놓지 않는다(표에는 모두). */
export const TREND_TRIGGER = /^(baseline|weekly|rescore:(baseline|weekly))$/;

/** 재채점 런의 원본 run_id(접미 -r<n>)와 번호 — 원본이면 n 0. */
const rescoreOf = (runId: string, trigger: string) => {
  const m = trigger.startsWith("rescore:") ? runId.match(/^(.*)-r(\d+)$/) : null;
  return m ? { base: m[1]!, n: Number(m[2]) } : { base: runId, n: 0 };
};
const rescoreTag = (runId: string, trigger: string) => {
  const r = rescoreOf(runId, trigger);
  return r.n ? ` 재채점 r${r.n}` : "";
};

/**
 * 원본과 재채점을 선으로 잇지 않는다(같은 모델 출력을 다시 채점한 것이라 추이가 아니다 — 운영자 2026-11-14, 설계서 v0.1.43).
 * 같은 원본은 재채점 번호가 가장 큰 1점만, 원본은 런 표에만. 입력 순서(최근 먼저)는 지킨다.
 */
export function trendPoints(runs: readonly EvalRunSummary[]): EvalRunSummary[] {
  const best = new Map<string, EvalRunSummary>();
  for (const x of runs) {
    if (!TREND_TRIGGER.test(x.trigger) || x.total < 60) continue;
    const { base, n } = rescoreOf(x.runId, x.trigger);
    const cur = best.get(base);
    if (!cur || rescoreOf(cur.runId, cur.trigger).n < n) best.set(base, x);
  }
  const keep = new Set(best.values());
  return runs.filter((x) => keep.has(x));
}

export function EvalsView({ r }: { r: { runs: EvalRunSummary[]; variance: EvalVariance | null } }) {
  if (r.runs.length === 0) return <p className="muted">아직 적재된 평가 런이 없습니다.</p>;
  const trend = trendPoints(r.runs);
  return (
    <>
      <section>
        <h2>4축 추이(60문항 런 {trend.length}개)</h2>
        <p className="muted small">normal 모드 60문항 기준(기준선·주간 — 재채점이 있으면 그 원본 대신 최신 재채점 1점, 원본은 아래 표에만). 규정 검색을 끈 모드(rulesUnavailable)는 따로 센다. 관문값·목표는 evals/THRESHOLDS.md.</p>
        {trend.length ? <TrendChart runs={trend} /> : <p className="muted">아직 60문항 런이 없습니다.</p>}
      </section>
      <section>
        <h2>런</h2>
        <RunsTable runs={r.runs} />
      </section>
      <section>
        <h2>실행 간 분산(부록 A 12건, n=3)</h2>
        {r.variance ? <VarianceTable v={r.variance} /> : <p className="muted">아직 variance 런이 없습니다.</p>}
      </section>
    </>
  );
}

export function Evals() {
  const s = useLoad(() => api.evals(), []);
  return (
    <>
      <header>
        <nav className="tabs" aria-label="화면">
          <Link to={paths.select()}>처음으로</Link>
          <Link to={paths.budget()}>예산·관측</Link>
        </nav>
        <h1>평가 리포트</h1>
        <p className="lead">골든 60문항을 실제 모델로 돌려 그라운딩·거부·툴·내용 4축을 결정론으로 채점한다(LLM이 채점하지 않는다).</p>
      </header>
      <main>
        <Status s={s} />
        {s.state === "ok" && <EvalsView r={s.data} />}
      </main>
      <Footer />
    </>
  );
}

function AxesTable({ rows }: { rows: [string, EvalAxes][] }) {
  return (
    <div className="table-scroll">
<table className="budget" data-testid="evals-axes">
      <thead>
        <tr>
          <th scope="col">공급자</th>
          <th scope="col">통과</th>
          {AXES.map((a) => (
            <th scope="col" key={a.key}>
              {a.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, a]) => (
          <tr key={name}>
            <th scope="row">{name}</th>
            <td className="num">
              {a.passed}/{a.total}
            </td>
            {AXES.map((x) => (
              <td className="num" key={x.key}>
                {axisCell(a[x.key])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
</div>
  );
}

/** 접힌 상태에서도 보이는 실패 요약(빠진 사실·금지어·위반 토큰·거부 사유 — 펼치면 기대·실제 본문). */
export function failureBrief(c: EvalCase): string {
  const v = c.violations;
  const tokens = v ? [...(v.g1Shape ?? []), ...(v.g4Missing ?? []).map((t) => `G4 ${t}`), ...(v.g5Unknown ?? []).map((t) => `G5 ${t}`), ...(v.g6Words ?? []).map((t) => `G6 ${t}`)] : [];
  const parts = [
    c.error ? `오류 ${c.error.slice(0, 60)}` : null,
    c.refused && c.reason ? `거부 ${c.reason}${c.expectRefusal ? ` (기대 ${c.expectReason})` : ""}` : null,
    c.missingFacts.length ? `빠진 사실 ${c.missingFacts.length}: ${c.missingFacts[0]}${c.missingFacts.length > 1 ? " …" : ""}` : null,
    c.forbiddenHits.length ? `금지어 ${c.forbiddenHits.join(", ")}` : null,
    tokens.length ? tokens.slice(0, 3).join(" · ") + (tokens.length > 3 ? " …" : "") : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

function CaseRow({ c }: { c: EvalCase }) {
  const v = c.violations;
  const tokens = v ? [...(v.g1Shape ?? []).map((t) => `G1 ${t}`), ...(v.g4Missing ?? []).map((t) => `G4 ${t}`), ...(v.g5Unknown ?? []).map((t) => `G5 ${t}`), ...(v.g6Words ?? []).map((t) => `G6 ${t}`)] : [];
  return (
    <tr className={c.passed ? undefined : "failed"}>
      <th scope="row">
        {c.caseId}
        <span className="muted small note-line">{BUCKET_LABEL[c.bucket]}</span>
      </th>
      <td>
        <details>
          <summary>
            {c.question ?? c.caseId}
            {!c.passed && failureBrief(c) && <span className="muted small note-line">{failureBrief(c)}</span>}
          </summary>
          <dl className="case-detail">
            <dt>기대</dt>
            <dd>
              {c.expectRefusal ? `거부 ${c.expectReason}` : c.facts.join(" · ")}
              {c.expectedTools.length > 0 && <span className="muted small note-line">툴 {c.expectedTools.map((t) => `${t.tool}(${Object.values(t.args).join(",")})${t.optional ? " 선택" : ""}`).join(" ")}</span>}
            </dd>
            <dt>실제</dt>
            <dd>
              {c.error ? c.error : c.refused ? `거부 ${c.reason}` : c.text}
              {c.toolCalls.length > 0 && <span className="muted small note-line">툴 {c.toolCalls.map((t) => `${t.tool}(${Object.values(t.args).join(",")})`).join(" ")}</span>}
            </dd>
            {(c.missingFacts.length > 0 || c.forbiddenHits.length > 0) && (
              <>
                <dt>내용</dt>
                <dd>
                  {c.missingFacts.length > 0 && `빠진 사실: ${c.missingFacts.join(" · ")}`}
                  {c.forbiddenHits.length > 0 && ` 금지어: ${c.forbiddenHits.join(", ")}`}
                </dd>
              </>
            )}
            {tokens.length > 0 && (
              <>
                <dt>검증 위반</dt>
                <dd>{tokens.join(" · ")}</dd>
              </>
            )}
          </dl>
        </details>
      </td>
      <td>{c.passed ? "통과" : FAILURE_LABEL[c.failureKind ?? ""] ?? "실패"}</td>
      <td>{providerLabel(c.provider)}</td>
    </tr>
  );
}

function CasesTable({ cases, testId }: { cases: EvalCase[]; testId: string }) {
  return (
    <div className="table-scroll">
<table className="budget evals-cases" data-testid={testId}>
      <thead>
        <tr>
          <th scope="col">케이스</th>
          <th scope="col">질문 · 기대 · 실제</th>
          <th scope="col">결과</th>
          <th scope="col">공급자</th>
        </tr>
      </thead>
      <tbody>
        {cases.map((c) => (
          <CaseRow key={`${c.caseId}#${c.mode}`} c={c} />
        ))}
      </tbody>
    </table>
</div>
  );
}

export function EvalRunView({ d }: { d: EvalRunDetail }) {
  const r = d.run;
  return (
    <>
      <section>
        <dl>
          <dt>시작</dt>
          <dd>{r.startedAt}</dd>
          <dt>트리거</dt>
          <dd>{r.trigger}</dd>
          <dt>프롬프트</dt>
          <dd>{versions(r.promptVersions)}</dd>
          <dt>통과</dt>
          <dd>
            {r.passed}/{r.total}
          </dd>
          <dt>평균 지연</dt>
          <dd>
            {r.meanLatencyMs === null ? "—" : `${r.meanLatencyMs.toLocaleString("ko-KR")}ms`}
            {r.latencyIncludesWait && <span className="muted small note-line">호출 간격 포함 — 이 런의 하네스는 Groq 호출 사이 30초 대기를 응답 시간에 넣었다(다음 런부터 뺀다)</span>}
          </dd>
        </dl>
      </section>
      <section>
        <h2>모델별 4축</h2>
        <p className="muted small">같은 런 안에서 공급자마다 맡은 케이스가 다르다 — 주간 런은 유형별로 번갈아 배정한다(설계서 v0.1.41).</p>
        <AxesTable rows={Object.entries(d.byProvider).map(([p, a]) => [providerLabel(p), a])} />
      </section>
      <section>
        <h2>유형별 통과</h2>
        <table className="budget" data-testid="evals-buckets">
          <tbody>
            {d.byBucket.map((b) => (
              <tr key={b.bucket}>
                <th scope="row">{BUCKET_LABEL[b.bucket]}</th>
                <td className="num">
                  {b.passed}/{b.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2>케이스({d.cases.length}건, 실패 먼저)</h2>
        <CasesTable cases={d.cases} testId="evals-cases" />
      </section>
      {d.rulesUnavailable.length > 0 && (
        <section>
          <h2>규정 검색을 끈 모드({d.rulesUnavailable.length}건 — 4축 집계 밖)</h2>
          <CasesTable cases={d.rulesUnavailable} testId="evals-ru" />
        </section>
      )}
    </>
  );
}

export function EvalRun({ runId }: { runId: string }) {
  const s = useLoad(() => api.evalRun(runId), [runId]);
  return (
    <>
      <header>
        <nav className="tabs" aria-label="화면">
          <Link to={paths.evals()}>평가 리포트</Link>
        </nav>
        <h1>{runId}</h1>
      </header>
      <main>
        <Status s={s} empty="없는 평가 런입니다" />
        {s.state === "ok" && <EvalRunView d={s.data} />}
      </main>
      <Footer />
    </>
  );
}
