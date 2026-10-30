# prompts/explain_limit CHANGELOG

## v1 (2026-10-31)

- 최초 작성(설계서 v0.1.14 §4.1(b)·부록 B.4, Phase 3 항목 2). 출력 `contracts/explain/v1/explanation-llm.schema.json` — `{text, citedFields, numbersUsed}`.

## v2 (2026-10-31)

- v1 녹화 16건 첫 시도 G4~G6 통과 12/16(75%, 검증기 상품 키 제외 수정 뒤) < 80% 관문(설계서 v0.1.14 §4.1(b)) → 배치 전 개정. 근거: `docs/evidence/logs/phase-3-explain-record-v1.log`.
- 계산식·중간값 금지를 명시(v1: "120,000원 × 0.05 = 6,000원" — G4 실패), 개수를 숫자로 쓰지 않기("라인 1건" — G4 실패), citedFields는 맨 위부터의 전체 경로("policyMasked" — G5 실패).
- 코드 용어집 추가(v1: RENEWAL을 "신계약 수수료", rate 7을 "7%"·"기준 금리"로 오해, 마감월을 "계약 종료월"로 오해). 경로·코드 이름을 본문에 쓰지 않기.
- 라인: limitPosting은 "현재"가 아니라 "이 라인 전기 뒤". 한도: 삭감·이연이 있는데 분급 스케줄이 없으면 지급 예정월은 데이터로 확인되지 않는다고 쓰기(부록 A-02).
