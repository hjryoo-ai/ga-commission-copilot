// 사규집 청킹(설계서 §4.1(c)·§5.2, PHASES Phase 4 항목 1 — 조항 단위, 300~600토큰). 토큰은 o200k(gpt-oss 계열 토크나이저) — 청크가 런타임 답변 프롬프트의 <rules>에 들어가 Groq TPM 8K를 쓰기 때문(§10.2).
import { createHash } from "node:crypto";
import { countTokens } from "gpt-tokenizer/encoding/o200k_base";
import { articleLabel, type ArticlePlan, type Visibility } from "./articles.ts";

export const CHUNK_MIN_TOKENS = 300;
export const CHUNK_MAX_TOKENS = 600;

export interface ArticleText {
  no: number;
  title: string;
  visibility: Visibility;
  body: string;
}

export interface Chunk {
  chunkId: string;
  article: string;
  title: string;
  body: string;
  visibility: Visibility;
  version: string;
  tokenCount: number;
}

export const tokens = (s: string) => countTokens(s);

/** 조항 머리 — 청크마다 붙여 청크 하나만 읽어도 어느 조항인지와 가상 규정임을 알게 한다(§4.1(c)). */
export const headOf = (a: Pick<ArticlePlan, "no" | "title">, part = 0) => `${articleLabel(a.no)}(${a.title})${part > 0 ? " (이어서)" : ""} — 가상 규정 · 예시값`;

/** 사규집 버전 = 조항 본문(번호·제목·공개 범위·본문)의 SHA-256. 같은 본문이면 같은 버전(결정론). */
export function rulebookHash(articles: readonly ArticleText[]): string {
  const canon = [...articles].sort((a, b) => a.no - b.no).map((a) => ({ no: a.no, title: a.title, visibility: a.visibility, body: a.body }));
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}

/** 항(줄) 단위로 600토큰 안에서 묶는다. 한 항이 넘으면 문장으로 나눈다. 마지막 조각이 300 미만이고 앞 조각과 합쳐 600 이하면 합친다. */
export function splitArticle(a: Pick<ArticleText, "no" | "title" | "body">): string[] {
  const head = headOf(a, 1);
  const fits = (parts: readonly string[]) => tokens(`${head}\n${parts.join("\n")}`) <= CHUNK_MAX_TOKENS;
  const pieces: string[] = [];
  for (const p of a.body.split(/\n+/).map((x) => x.trim()).filter(Boolean)) {
    if (fits([p])) pieces.push(p);
    else {
      for (const s of p.split(/(?<=[.!?。])\s+/)) {
        if (!fits([s])) throw new Error(`${articleLabel(a.no)}: 한 문장이 ${CHUNK_MAX_TOKENS}토큰을 넘는다`);
        pieces.push(s);
      }
    }
  }
  const groups: string[][] = [];
  for (const p of pieces) {
    const last = groups.at(-1);
    if (last && fits([...last, p])) last.push(p);
    else groups.push([p]);
  }
  if (groups.length >= 2) {
    const tail = groups.at(-1)!;
    const prev = groups.at(-2)!;
    if (tokens(`${head}\n${tail.join("\n")}`) < CHUNK_MIN_TOKENS && fits([...prev, ...tail])) {
      prev.push(...tail);
      groups.pop();
    }
  }
  return groups.map((g) => g.join("\n"));
}

export function chunksOf(articles: readonly ArticleText[], version: string): Chunk[] {
  if (!/^[0-9a-f]{12}$/.test(version)) throw new Error(`version ${version}: 12자리 16진 아님`);
  return [...articles]
    .sort((a, b) => a.no - b.no)
    .flatMap((a) =>
      splitArticle(a).map((part, i) => {
        const body = `${headOf(a, i)}\n${part}`;
        return {
          chunkId: `rb-${version}-a${String(a.no).padStart(2, "0")}-${i + 1}`,
          article: articleLabel(a.no),
          title: a.title,
          body,
          visibility: a.visibility,
          version,
          tokenCount: tokens(body),
        };
      }),
    );
}
