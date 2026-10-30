// 화면 1 설계사 선택(설계서 §8-1): 데모 설계사 3명 카드 + 한 줄 설명 + "이 데모가 하지 않는 것".
import { useState } from "react";
import { api, type DemoAgentCard } from "../api";
import { navigate, paths } from "../router";
import { Chips, Footer, Status, useLoad } from "../ui";

export function SelectAgent() {
  const s = useLoad(() => api.demoAgents(), []);
  const [busy, setBusy] = useState<number | null>(null);

  const pick = async (card: DemoAgentCard) => {
    setBusy(card.demoNo);
    try {
      await api.session(card.demoNo);
      navigate(paths.statement());
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <header>
        <Chips generatedAt={s.state === "ok" ? s.data.generatedAt : undefined} />
        <h1>GA 수수료 설명 코파일럿</h1>
        <p className="lead">가상 GA의 수수료 명세·한도 원장을 보고, 금액이 왜 그렇게 나왔는지 근거와 함께 읽는 데모입니다.</p>
      </header>
      <main>
        <h2>데모 설계사 선택</h2>
        <Status s={s} />
        {s.state === "ok" && (
          <ul className="cards">
            {s.data.items.map((c) => (
              <li key={c.demoNo}>
                <button type="button" className="card agent" data-testid={`demo-agent-${c.demoNo}`} disabled={busy !== null} onClick={() => void pick(c)}>
                  <span className="demo-no">데모 설계사 {c.demoNo}</span>
                  <strong>{c.agentName ?? "이름 없음"}</strong>
                  <span className="meta">
                    {[c.grade, c.orgPath].filter(Boolean).join(" · ")} · 계약 {c.contractCount}건
                  </span>
                  <span className="case">{c.cardLabel}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <section className="note">
          <h2>이 데모가 하지 않는 것</h2>
          <ul>
            <li>수수료를 계산하지 않습니다 — 엔진이 낸 값을 그대로 보여 줍니다.</li>
            <li>고객에게 보여 줄 자료가 아닙니다 — 설계사 참고용입니다.</li>
            <li>실제 회사 규정을 판정하지 않습니다 — 가상 사규로만 설명합니다.</li>
          </ul>
        </section>
      </main>
      <Footer />
    </>
  );
}
