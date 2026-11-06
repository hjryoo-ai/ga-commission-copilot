// 설계사 화면 틀: 상단 칩 · 탭(명세·한도·질문) · 설계사 바꾸기 · 고정 문구.
import type { ReactNode } from "react";
import { type AsOf, api } from "../api";
import { Link, paths } from "../router";
import { Chips, Footer, useLoad } from "../ui";

export function Shell({ asOf, title, children }: { asOf?: AsOf; title: string; children: ReactNode }) {
  // 칩의 오늘 남은 질문·프롬프트 버전(설계서 v0.1.27 §6.2 — 소진이 갑작스럽지 않게 늘 표시). /me는 no-store라 화면마다 새로 읽는다
  const me = useLoad(() => api.me(), []);
  return (
    <>
      <header>
        <Chips asOf={asOf} me={me.state === "ok" ? me.data : undefined} />
        <nav className="tabs" aria-label="화면">
          <Link to={paths.statement()}>명세</Link>
          <Link to={paths.limits()}>한도</Link>
          <Link to={paths.ask()}>질문</Link>
          <Link to={paths.select()} className="switch">
            설계사 바꾸기
          </Link>
        </nav>
        <h1>{title}</h1>
      </header>
      <main>{children}</main>
      <Footer />
    </>
  );
}
