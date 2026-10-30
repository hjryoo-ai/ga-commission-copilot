// 설계사 화면 틀: 상단 칩 · 탭(명세·한도) · 설계사 바꾸기 · 고정 문구.
import type { ReactNode } from "react";
import type { AsOf } from "../api";
import { Link, paths } from "../router";
import { Chips, Footer } from "../ui";

export function Shell({ asOf, title, children }: { asOf?: AsOf; title: string; children: ReactNode }) {
  return (
    <>
      <header>
        <Chips asOf={asOf} />
        <nav className="tabs" aria-label="화면">
          <Link to={paths.statement()}>명세</Link>
          <Link to={paths.limits()}>한도</Link>
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
