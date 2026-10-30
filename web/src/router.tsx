// 작은 경로기(의존성 없이 History API). 경로는 닫힌 목록 — 설계서 §8 화면 1~3 + 라인 상세.
import { type AnchorHTMLAttributes, type MouseEvent, useEffect, useState } from "react";

export type Route =
  | { name: "select" }
  | { name: "statement"; ym?: string }
  | { name: "line"; calcId: string }
  | { name: "limits" }
  | { name: "limit"; ledgerId: string }
  | { name: "notFound" };

export function match(path: string): Route {
  if (path === "/" || path === "") return { name: "select" };
  if (path === "/me/earnings") return { name: "statement" };
  let m = path.match(/^\/me\/earnings\/([0-9]{6})$/);
  if (m) return { name: "statement", ym: m[1]! };
  m = path.match(/^\/me\/earnings\/lines\/([^/]+)$/);
  if (m) return { name: "line", calcId: decodeURIComponent(m[1]!) };
  if (path === "/me/limits") return { name: "limits" };
  m = path.match(/^\/me\/limits\/([^/]+)$/);
  if (m) return { name: "limit", ledgerId: decodeURIComponent(m[1]!) };
  return { name: "notFound" };
}

export const paths = {
  select: () => "/",
  statement: (ym?: string) => (ym ? `/me/earnings/${ym}` : "/me/earnings"),
  line: (calcId: string) => `/me/earnings/lines/${encodeURIComponent(calcId)}`,
  limits: () => "/me/limits",
  limit: (ledgerId: string) => `/me/limits/${encodeURIComponent(ledgerId)}`,
};

export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function usePath(): string {
  const [path, setPath] = useState(() => (typeof location === "undefined" ? "/" : location.pathname));
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return path;
}

export function Link({ to, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={onClick} {...rest} />;
}
