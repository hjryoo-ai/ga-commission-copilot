// 라인 상세(설계서 §8-2): 근거(basis) 원본 표 · 한도 판정 · 계약 요약 · 분급·채권 · 원장 링크 · "이 금액이 나온 이유"(사전 생성 설명 — 근거 보기는 인용 필드 하이라이트).
import { useState } from "react";
import { api } from "../api";
import { citedClass, ExplanationBody } from "../explain";
import { ym as ymText } from "../format";
import { commTypeLabel, CONTRACT_LABEL, CUT_LABEL, DEFERRAL_LABEL, lineLabel, RECEIVABLE_LABEL } from "../labels";
import { Link, paths } from "../router";
import { Amount, Badge, Status, useLoad } from "../ui";
import { Shell } from "./Shell";

export function LineDetail({ calcId }: { calcId: string }) {
  const s = useLoad(async () => {
    const d = await api.line(calcId);
    // 라인 금액 라벨은 그 달 상태 — 월 응답에서 읽는다(화면은 상태를 짐작하지 않는다)
    const m = await api.month(d.line.closeYm);
    return { d, status: m.status };
  }, [calcId]);
  const d = s.state === "ok" ? s.data.d : undefined;
  const [cited, setCited] = useState<string[] | null>(null);
  const hl = (...f: string[]) => citedClass(cited, ...f);

  return (
    <Shell asOf={d?.asOf} title="라인 상세">
      <Status s={s} />
      {s.state === "ok" && d && (
        <>
          <section className="card" data-testid="line-detail">
            <h2>
              {commTypeLabel(d.line.commType)} <Badge>{ymText(d.line.closeYm)}</Badge>
            </h2>
            <p className={hl("line.amount") ? "headline cited" : "headline"}>
              <Amount value={d.line.amount} label={lineLabel(d.line.commType, s.data.status)} big />
            </p>
            <p className="meta">
              {d.line.policyMasked}
              {d.line.productKey ? ` · ${d.line.productKey}` : ""}
            </p>
            {d.line.limitCutAmt > 0 && (
              <p className={hl("line.limitCutAmt", "derived.requested")}>
                {CUT_LABEL} <Amount value={d.line.limitCutAmt} label="원장 기준" />
              </p>
            )}
            <p>
              <Link to={paths.statement(d.line.closeYm)}>{ymText(d.line.closeYm)} 명세로</Link>
              {d.ledgerId && (
                <>
                  {" · "}
                  <Link to={paths.limit(d.ledgerId)}>이 계약 한도 원장</Link>
                </>
              )}
            </p>
          </section>

          <section>
            <h3>근거(엔진이 준 값)</h3>
            <table className="basis">
              <tbody>
                {d.basis.rate && (
                  <tr className={hl("basis.rate")}>
                    <th scope="row">적용 요율</th>
                    <td>{d.basis.rate}</td>
                  </tr>
                )}
                {d.basis.payoutRate && (
                  <tr className={hl("basis.payoutRate")}>
                    <th scope="row">지급률</th>
                    <td>{d.basis.payoutRate}</td>
                  </tr>
                )}
                {d.basis.installmentNo !== undefined && (
                  <tr className={hl("basis.installmentNo")}>
                    <th scope="row">회차</th>
                    <td>{d.basis.installmentNo}회</td>
                  </tr>
                )}
                {d.policySummary.contractDate && (
                  <tr className={hl("policySummary.contractDate")}>
                    <th scope="row">계약일</th>
                    <td>{d.policySummary.contractDate}</td>
                  </tr>
                )}
                {d.policySummary.monthlyPremium !== undefined && (
                  <tr className={hl("policySummary.monthlyPremium")}>
                    <th scope="row">월납 보험료</th>
                    <td>
                      <Amount value={d.policySummary.monthlyPremium} label={CONTRACT_LABEL} />
                    </td>
                  </tr>
                )}
                {d.basis.ruleVersionIds.map((r) => (
                  <tr key={r}>
                    <th scope="row">규칙 버전</th>
                    <td className="mono">{r}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {d.deferrals.length > 0 && (
            <section>
              <h3>분급 {d.deferrals.length}건</h3>
              <ul className="plain">
                {d.deferrals.map((x, i) => (
                  <li key={x.scheduleId} className={hl(`deferrals.${i}`)}>
                    {ymText(x.dueYm)} <Amount value={x.amount} label={DEFERRAL_LABEL[x.status]} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {d.receivable && (
            <section className={hl("receivable")}>
              <h3>환수 채권</h3>
              <p>
                채권 <Amount value={d.receivable.amount} label={RECEIVABLE_LABEL[d.receivable.status] ?? d.receivable.status} /> · 잔액{" "}
                <Amount value={d.receivable.remaining} label={RECEIVABLE_LABEL[d.receivable.status] ?? d.receivable.status} />
              </p>
            </section>
          )}

          <section className="explain">
            <h3>이 금액이 나온 이유</h3>
            <ExplanationBody e={d.explanation} onCite={setCited} />
          </section>
        </>
      )}
    </Shell>
  );
}
