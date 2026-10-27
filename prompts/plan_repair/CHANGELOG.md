# prompts/plan_repair CHANGELOG

## v1 (2026-10-27)

- 최초 작성. `prompts/plan/v1.md` 출력이 의미 검사(`gen/world/plan-check.ts`)에서 거부되면 [처음 지시, 직전 출력, 이 프롬프트(위반 목록)]로 다시 묻는다.
- 도입 계기: 첫 녹화에서 A-1002 출력이 temperature 0 재시도 3회 모두 같은 위반(실효 없이 REINSTATE)으로 거부됨.
