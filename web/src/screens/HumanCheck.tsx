// 사람 확인(설계서 v0.1.29 §9, PHASES Phase 5 항목 5): Turnstile 위젯(명시적 렌더) → 토큰을 서버로(POST /me/turnstile) → 24시간 쿠키.
// 스크립트는 위젯이 필요할 때만 한 번 싣는다(challenges.cloudflare.com — Turnstile 공식 경로). 토큰은 화면·로그에 남기지 않는다.
import { useEffect, useRef, useState } from "react";
import { api, HumanCheckRequired, Unauthenticated } from "../api";
import { navigate, paths } from "../router";

export const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(el: HTMLElement, opts: { sitekey: string; language?: string; callback(token: string): void; "error-callback"(): void; "expired-callback"(): void }): string;
  reset(id?: string): void;
  remove(id?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = TURNSTILE_SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile 없음")));
    s.onerror = () => {
      loading = null;
      reject(new Error("turnstile 스크립트"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

type CheckState = "idle" | "checking" | "failed";

/**
 * 화면 4 입력창 위 — 확인이 끝나면 onVerified. 서버가 거부하면 위젯을 자동으로 다시 돌리지 않고 "다시 확인" 버튼을 둔다
 * (자동 통과 모드에서 거부 → 초기화 → 자동 통과 → 거부가 끝없이 돌지 않게 — 2026-11-06 로컬 시험 키에서 확인).
 */
export function HumanCheck({ siteKey, onVerified }: { siteKey: string; onVerified(): void }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<CheckState>("idle");
  const widget = useRef<{ ts: TurnstileApi; id: string } | null>(null);
  useEffect(() => {
    let id: string | undefined;
    let ts: TurnstileApi | undefined;
    let alive = true;
    loadTurnstile()
      .then((t) => {
        if (!alive || !box.current) return;
        ts = t;
        id = t.render(box.current, {
          sitekey: siteKey,
          language: "ko",
          callback: (token) => {
            setState("checking");
            api.turnstile(token).then(onVerified, (e: unknown) => {
              if (e instanceof Unauthenticated) return navigate(paths.select(), true);
              setState("failed");
              if (!(e instanceof HumanCheckRequired)) console.warn("turnstile 확인 실패");
            });
          },
          "error-callback": () => setState("failed"),
          "expired-callback": () => t.reset(id),
        });
        widget.current = { ts: t, id };
      })
      .catch(() => alive && setState("failed"));
    return () => {
      alive = false;
      widget.current = null;
      if (ts && id) ts.remove(id);
    };
  }, [siteKey, onVerified]);
  return (
    <div className="human-check" data-testid="human-check">
      <p className="small muted">질문하기 전에 사람 확인을 한 번 마치세요(같은 네트워크에서 24시간 유지).</p>
      <div ref={box} />
      {state === "checking" && <p className="small muted">확인하는 중…</p>}
      {state === "failed" && (
        <p className="small muted">
          확인하지 못했습니다.{" "}
          <button
            type="button"
            className="linklike"
            onClick={() => {
              setState("idle");
              widget.current?.ts.reset(widget.current.id);
            }}
          >
            다시 확인
          </button>
        </p>
      )}
    </div>
  );
}
