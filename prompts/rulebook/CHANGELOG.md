# prompts/rulebook CHANGELOG

## v1 (2026-11-01)

- 최초 작성(설계서 §4.1(c), PHASES Phase 4 항목 1). 조항 하나당 1회 호출, 출력 `contracts/rulebook/v1/article-llm.schema.json` — `{body, numbersUsed}`.
- 조항 번호·제목·공개 범위·다룰 내용·값(`<data>`)은 코드(`gen/rulebook/articles.ts`)가 주고, 본문 숫자는 그 값만 — G4로 검사(규약 1). 조항 머리와 "가상 규정 · 예시값"은 코드가 붙인다.
- 지시문 형태 문장 금지(설계서 §6.5 — G6에서 따로 거른다).
