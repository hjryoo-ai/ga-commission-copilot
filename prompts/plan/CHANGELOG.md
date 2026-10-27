# prompts/plan CHANGELOG

## v1 (2026-10-27)

- 최초 작성(설계서 §4.1(a)·부록 B.3, Phase 1 항목 2). 설계사 1명당 1회 호출, 출력 `contracts/plan/v1/plan-llm.schema.json`.
- 필수 케이스 12건은 프롬프트에 넣지 않는다(코드가 플랜에 먼저 주입 — `gen/world/forced.ts`). 설계사별 제약(A-1001·A-1007)은 `<data>.constraints`로 전달.
