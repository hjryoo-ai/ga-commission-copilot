// 답변 카세트 재생(운영자 2026-11-01 — 답변 VCR 방식). worker/test/vcr/answer.json은 gen/scripts/answer-cassette.ts가 로컬 llm_trace에서 뽑는다.
// 요청 해시(providers.ts requestHash)로 찾고, 없으면 실패한다(프롬프트·컨텍스트·툴 결과가 녹화 때와 다르다).
import { type Provider, requestHash } from "../src/llm/providers";
import cassette from "./vcr/answer.json";

export interface CassetteEntry {
  provider: string;
  model: string;
  recordedAt: string;
  request: unknown;
  response: { json: unknown; model: string; usage: { prompt_tokens?: number; completion_tokens?: number } | null };
}

export const ANSWER_CASSETTE = cassette as { kind: "vcr"; name: "answer"; entries: Record<string, CassetteEntry> };

export function vcrProvider(entries: Readonly<Record<string, CassetteEntry>> = ANSWER_CASSETTE.entries): Provider {
  return {
    name: "groq",
    async structured(req) {
      const h = await requestHash(req);
      const e = entries[h];
      if (!e) throw new Error(`[stub] vcr answer: 요청 ${h.slice(0, 12)} 녹화 없음 — 다시 녹화(LLM_TRACE=1 + wrangler dev --local)`);
      return { json: e.response.json, provider: "groq", model: e.response.model, usage: e.response.usage };
    },
  };
}
