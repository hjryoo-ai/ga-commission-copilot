// 공통 조각: 금액은 라벨과 함께만(상위 §6.2 — 라벨 없는 금액은 타입 오류), 상단 칩, 배지, 불러오기.
import { type DependencyList, type ReactNode, useEffect, useState } from "react";
import { type AsOf, type Me, NotFound, questionsLeft, Unauthenticated } from "./api";
import { DISCLAIMER } from "./disclaimer";
import { mmdd, won } from "./format";
import { navigate, paths } from "./router";

export function Amount({ value, label, big = false }: { value: number; label: string; big?: boolean }) {
  return (
    <span className={big ? "amount big" : "amount"}>
      <span className="num">{won(value)}</span> <span className="tag">{label}</span>
    </span>
  );
}

export function Badge({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "warn" | "crit" | "muted" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

/** 검증 상태 배지(설계서 §8 화면 2) — Phase 2는 설명이 없다(explanation null). */
export const NoExplanation = () => <Badge tone="muted">설명 없음</Badge>;

/** 상단 칩 3개(설계서 §8 공통): 기준 데이터 · 오늘 남은 질문(v0.1.27 — /me budget) · 프롬프트 answer 버전. /me가 없으면(설계사 선택·불러오는 중) 뒤 두 칸은 자리만. */
export function Chips({ asOf, generatedAt, me }: { asOf?: AsOf; generatedAt?: string; me?: Me }) {
  const at = asOf?.generatedAt ?? generatedAt;
  return (
    <ul className="chips" aria-label="데이터 상태">
      <li className="chip" data-testid="chip-data">
        {at ? `기준 데이터 ${mmdd(at)} 생성` : "기준 데이터 확인 중"}
        {asOf ? ` · 데모 설계사 ${asOf.demoNo}` : ""}
      </li>
      {me?.budget ? (
        <li className={questionsLeft(me.budget) === 0 ? "chip warn" : "chip"} data-testid="chip-budget">
          오늘 남은 질문 {questionsLeft(me.budget)}회
        </li>
      ) : (
        <li className="chip placeholder" aria-disabled="true">
          오늘 남은 질문 —
        </li>
      )}
      {me?.promptVersions?.answer ? (
        <li className="chip" data-testid="chip-prompt">
          프롬프트 answer={me.promptVersions.answer}
        </li>
      ) : (
        <li className="chip placeholder" aria-disabled="true">
          프롬프트 —
        </li>
      )}
    </ul>
  );
}

export const Footer = () => <footer>{DISCLAIMER}</footer>;

export type Load<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "notFound" } | { state: "error" };

/** 불러오기. 401이면 설계사 선택으로 보낸다(세션 없음·스트림 교체). */
export function useLoad<T>(load: () => Promise<T>, deps: DependencyList): Load<T> {
  const [s, setS] = useState<Load<T>>({ state: "loading" });
  useEffect(() => {
    let live = true;
    setS({ state: "loading" });
    load().then(
      (data) => live && setS({ state: "ok", data }),
      (e: unknown) => {
        if (!live) return;
        if (e instanceof Unauthenticated) navigate(paths.select(), true);
        else setS({ state: e instanceof NotFound ? "notFound" : "error" });
      },
    );
    return () => {
      live = false;
    };
  }, deps);
  return s;
}

export function Status({ s, empty = "찾을 수 없습니다" }: { s: Load<unknown>; empty?: string }) {
  if (s.state === "loading") return <p className="muted">불러오는 중…</p>;
  if (s.state === "notFound") return <p className="muted">{empty}</p>;
  if (s.state === "error") return <p className="muted">잠시 후 다시 시도하세요</p>;
  return null;
}
