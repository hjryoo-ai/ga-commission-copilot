# prompts/explain_repair CHANGELOG

## v1 (2026-10-31)

- 최초 작성(설계서 v0.1.14 §4.1(b)·부록 B.4, Phase 3 항목 2). 출력 `contracts/explain/v1/explanation-llm.schema.json` — `{text, citedFields, numbersUsed}`.
- G4·G5·G6 위반 뒤 재생성 1회에 붙이는 메시지(Phase 3 항목 3). 첫 요청 메시지 + 거부된 출력 + 이 메시지.
