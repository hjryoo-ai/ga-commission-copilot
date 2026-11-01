# prompts/answer CHANGELOG

## v1 (2026-11-01)

- 최초 작성(설계서 §4.3·§4.4·§6.5, 부록 B.1 골격, PHASES Phase 4 항목 3). 출력 `contracts/answer/v1/answer.schema.json`.
- 부록 B.1 규칙 1~6 그대로 + 단계(1단계 툴 계획 / 2단계 최종 답 — §4.3의 LLM 2회를 같은 스키마로), 툴 4종 설명, 거부 사유별 조건, 인용(citations) 규칙. 자리표시자는 `{{rules}}`·`{{data}}`·`{{question}}`·`{{stage}}`(B.1의 `{…}` 표기 대신 저장소 공통 `{{…}}`).
