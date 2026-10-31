# Phase 3 — 그라운딩 검증기 + 설명 사전 생성 증거

- 수행일: 2026-10-31(KST) / 2026-10-30 UTC — 항목 1~5. 2026-10-31 04:54~05:20 UTC — v3·v4 녹화, 원격 슬롯 b·0004·설명 적재
- 기준 문서: 설계서 v0.1.15 §4.1(b)·§4.2 G4~G6·§5.1·§5.3·§5.4·§6.1·§7·§8·§10.4, 부록 A-01~A-03·B.4, PHASES.md Phase 3
- 도구 버전: node 25.5.0(CI 24), pnpm 10.28.2, wrangler 4.153.0, vitest 4.1.12, @playwright/test 1.64.1, JDK 25.0.5. LLM: Groq `openai/gpt-oss-120b`(녹화)
- 상태: 항목 1~5 수용(2026-10-31). **설명 배치 미실행 — v4가 배치 관문(첫 시도 ≥ 90% · 뜻 오류 4종 0건)의 4종 쪽에서 경계 1건으로 미달, 운영자 지시대로 멈추고 보고**(아래 v4 점검표). 원격: 슬롯 b 적재·`/health`·0004·v4 녹화 16건 적재·`verify:explain --remote` 완료

## 녹화 16건 G4·G5·G6 통과율(배치 전 보고 — 운영자 지시)

데모 3명에서 LINE 10·LIMIT 3·MONTH_DIFF 3(`gen/explain/run.ts vcrSubjects` — A-1 라인 1·2·6, 원장 1, 202702 포함, 결정론). 통과율 = **첫 시도**(재생성 없이) G1·G4·G5·G6 모두 통과한 비율. 재생성 1회 뒤 값도 함께 적는다.

| 프롬프트 | 첫 시도 | 재생성 1회 뒤 | Groq 호출 | 판정 |
|---|---|---|---|---|
| `explain_*/v1` | **12/16 = 75.0%** (LINE 6/10 · LIMIT 3/3 · MONTH 3/3) | 15/16 | 22 | 80% 미만 → v2 먼저 |
| `explain_*/v2` | **15/16 = 93.8%** (LINE 10/10 · LIMIT 3/3 · MONTH 2/3) | **16/16** | 17 | 배치 가능(80% 관문) → 운영자: 뜻 오류 4종을 먼저 없애라(v3) |
| `explain_*/v3` | **16/16 = 100%** (LINE 10/10 · LIMIT 3/3 · MONTH 3/3) | 16/16 | 8 + 1(400) + 진단 3 + 8 = 20 | G ≥ 90% 통과, **4종 점검 미달**(① 2 · ③ 3) → v4 |
| `explain_*/v4` | **15/16 = 93.8%** (LINE 10/10 · LIMIT 3/3 · MONTH 2/3) | **16/16** | 17 | G ≥ 90% 통과, **4종 점검 경계 1건 → 멈춤·보고** |

- v1 실패 원인(로그 `logs/phase-3-explain-record-v1.log`): 계산식 작성("120,000원 × 0.05 = 6,000원" — G4 ×2), 개수("라인 1건" — G4), 인용 경로 접두 누락("policyMasked" — G5). 처음 판정에선 상품 키 안의 숫자(`CHILD-30Y`·`WHOLE-LIFE-20Y`)도 G4에 걸렸는데 이는 **검증기 결함**이라 검증기를 고치고(대문자 코드 제외 — §6.1 4 "숫자가 아닌 식별자") 같은 녹화를 다시 판정한 값이 위 75%다(고치기 전 10/16).
- v1은 통과한 글도 뜻이 틀린 곳이 있었다: `rate 7` → "7%"·"기준 금리", RENEWAL → "신계약 수수료", 마감월 → "계약 종료월", 전기 직후 소진율을 "현재"로. v2는 용어집·계산식 금지·전체 경로·"이 라인 전기 뒤"·이연 예정월 없음 문구를 넣었다(`prompts/explain_*/CHANGELOG.md`).
- v2 유일한 첫 시도 실패: MONTH_DIFF A-1002 202607의 "2" — 용어집 "유지(2차년도 이후) 수수료"를 그대로 옮겼다. 재생성으로 통과. v3 후보(남은 이슈 1).
- 골든(부록 A, stub 고정 — `gen/test/explain-stream.test.ts`): A-01 라인 2 = 요청 1,000,000 · 지급 855,000 · 삭감 145,000 · 한도 1,800,000 · "한도", A-02 원장 1 = 145,000 · 이연 · "지급 예정월은 데이터로는 확인되지 않습니다", A-03 = 1,800,000 · 100.0%. 셋 다 통과.
- dev 예산: `budget_counter(scope=dev, day=2026-10-30)` used 39(= 22 + 17), `day=2026-10-31` used **37**(v3 20 + v4 17, 상한 100).
- v3 녹화 중 9번째 건(LINE A-1003 `c-A1003-01-1`)에서 Groq가 `400 json_validate_failed`(`failed_generation: ""` — 빈 출력)를 돌려 녹화가 멈췄다. 같은 요청을 출력 상한 1,500·3,000으로 다시 보내 보니(진단 3회, dev 예산) 1,500에서도 정상 응답 → 토큰 상한이 아니라 공급자 쪽 간헐 실패. `liveCall`이 이 400을 5xx처럼 같은 요청 재전송(최대 3회, `providerRetries`에 집계)으로 다루고, 3회 모두 실패면 `json=null`로 돌려 G1 실패 → 재생성·FAIL 경로를 타게 했다(배치가 멈추지 않는다). 이어 녹화한 v3 나머지 8건·v4 16건에서는 재발 0.
- v4 첫 시도 실패 1건: MONTH_DIFF A-1003 202607 — `numbersUsed`에 "1,823,630원"(컨텍스트 값 1,827,630원의 오기) → G4, 재생성으로 통과.
- 로그: `logs/phase-3-explain-record-v3.log`(첫 실행 400 중단 + 이어 녹화), `logs/phase-3-explain-record-v4.log`, 본문 `logs/phase-3-explain-v3-bodies.log`·`logs/phase-3-explain-v4-bodies.log`(v2 본문은 커밋 `fdee8eb`의 `data/explain/`).

## 뜻 오류 4종 수동 점검(운영자 배치 관문 — 16건 본문 0건)

운영자 정의: ① 부호를 쓰지 않고 "환수"·"차감" 같은 말로(방향이 맞아야 한다) ② 체결일·마감월·지급일 구분 ③ 코드 용어 금지(CLAWBACK→환수, RENEWAL→유지 수수료, 정책 번호→증권번호) ④ 용어집에 숫자 없음. 16건 본문을 한 건씩 읽어 판정하고, 기계 점검(정규식 — `-숫자`, 영문 알파벳, "정책/계약 번호", "클로백/갱신", "지급일", "N차년도")을 함께 돌렸다. ④는 프롬프트 용어 절의 숫자 0개(v3·v4 세 파일 모두 스크립트로 확인) + 본문 "N차년도" 0건.

| # | subject | v3 ① | v3 ② | v3 ③ | v4 ① | v4 ② | v4 ③ | 비고 |
|---|---|---|---|---|---|---|---|---|
| 1 | LINE A-1001 `1` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | v4: 체결일·원장 반영일을 나눠 씀 |
| 2 | LINE A-1001 `2`(A-01) | ✓ | ✓ | ✓ | ✓ | △ | △ | **v4: "한도 초과분은 다음 회계연도로 이연되었습니다"** — `DEFER_AFTER_FY`(초년도 뒤 이연)의 FY를 회계연도로 옮긴 코드 뜻 오역(③ "정책 번호"와 같은 계열)이자 데이터에 없는 이연 시점 짐작(②). 엄격 판정으로 1건 |
| 3 | LINE A-1001 `6` | ✓ | ✓ | ✗ "회수 종료(CLOSED)" | ✓ | ✓ | ✓ | |
| 4 | LINE A-1001 `c-A1001-09-1` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | v3·v4 모두 전기 뒤 누적을 "현재(까지)"로 씀 — 4종 밖(v2 규칙 "이 라인 전기 뒤") |
| 5 | LINE A-1001 `c-A1001-09-2` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| 6 | LINE A-1002 `c-A1002-06-2` | ✓ | ✓ | ✗ "회수 완료(CLOSED)", 경계 "계약 번호" | ✓ | ✓ | ✓ | |
| 7 | LINE A-1002 `c-A1002-01-2` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | v4: 월 보험료를 "기반으로" 적용했다는 계산 근거 서술 — 4종 밖(규칙 2 경계) |
| 8 | LINE A-1003 `c-A1003-01-2` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| 9 | LINE A-1003 `c-A1003-01-1` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| 10 | LINE A-1002 `c-A1002-01-1` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| 11 | LIMIT A-1001 `1`(A-02·A-03) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| 12 | LIMIT A-1002 `l-A1002-11` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | "2028년 1월에 지급되었고" = 분급 상태 지급됨(허용 예외) |
| 13 | LIMIT A-1003 `l-A1003-13` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| 14 | MONTH_DIFF A-1001 `202702`(A-06) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | v2의 "정책 번호" → v3·v4 "증권번호" |
| 15 | MONTH_DIFF A-1002 `202607` | ✗ "환수액이 … 발생하여 전월보다 크게 감소" | ✓ | ✓ | ✓ | ✓ | ✓ | v4: "환수가 1,102,500원 늘어났고" |
| 16 | MONTH_DIFF A-1003 `202607` | ✗ 환수 상계가 늘었는데 "줄어들어" | ✓ | ✗ "총액(gross)·환수 차감액(clawback offset)·순액(net)" | ✓ | ✓ | ✓ | |
| | **합계** | **2** | **0** | **3**(+경계 1) | **0** | **0**(경계 1) | **0**(경계 1) | 같은 1건(#2)을 ②·③ 양쪽에 걸쳐 경계로 표시 |

기계 점검(정규식, 16건씩): v2 — 부호 4 · 영문 13 · 정책/계약 번호 1 · 클로백/갱신 6. v3 — 부호 0 · 영문 3 · 계약 번호 1. **v4 — 전부 0**(남은 것은 "현재까지" 1 · "회계연도" 1 — 위 #4·#2).

판정: v4는 G 관문(첫 시도 93.8% ≥ 90%)과 4종의 표기 쪽(부호·영문 코드·"정책/계약 번호"·"N차년도" 0건)은 통과했다. 다만 #2의 "다음 회계연도로 이연"을 4종 안(코드 뜻 오역 = ③, 이연 시점 짐작 = ②)으로 세면 1건이라 "0건"에 못 미친다. 운영자 지시("미달이면 v4 한 번 더, 그래도 안 되면 멈추고 보고")대로 **배치를 시작하지 않고 멈췄다**. #2를 4종 밖으로 보면 v4로 바로 배치할 수 있다(코드·데이터·VCR·`PROMPT_VERSIONS`가 v4로 맞춰져 있다). v5를 만든다면 용어 표 `DEFER_AFTER_FY` 행에 "이연분이 언제 지급되는지는 데이터에 없다"를 넣고, 전기 뒤 값의 "현재" 금지를 자기 점검에 남기는 정도다.


## 완료 기준 대조

| # | 완료 기준(PHASES.md 원문) | 결과 | 증거 |
|---|---|---|---|
| 1 | 검증기 테스트 40건 통과 | 통과 — 63건(한국어 수량 "94만 5천 원"·"0.945백만"·"52.5%"·"7회차"·"2027년 2월", 근사어, 조항·순번·목록·ID 제외, 증권번호 뒷자리, 파생값 합계·요청액·잔여·소진율·전월 차이, U+200B·전각 숫자, G5·G6) | `packages/grounding/test/verifier.test.ts`, `logs/phase-3-pnpm-r-test.log` |
| 2 | stub 기준 설명 생성·적재·표시 | 통과(로컬) — `explain --stub` 16건 PASS → `load:d1 --local --explain` 16행 → API·화면(Playwright 8/8, 캡처 3장), 계약 스모크 789응답 0 오류. **v4로 다시**: stub 16 PASS(첫 시도 15/16) → 로컬 적재 16 → 재검증 위반 0 → Playwright 8/8(캡처 3장 v4 본문) → 스모크 789응답 0 오류(LINE·LIMIT·MONTH_DIFF PASS 10·3·3) — `logs/phase-3-*-v4.log` | `logs/phase-3-explain-stub.log`, `logs/phase-3-load-explain-local.log`, `logs/phase-3-playwright.log`, `logs/phase-3-smoke-contract.log`, `captures/phase-3-*.png` |
| 3 | 전수 재검증 0건 위반 | 통과 — 로컬(v2 16 + v4 16 = 32행) 위반 0, **원격(v4 16행, 2026-10-31 05:17 UTC) 위반 0**. D1 슬롯 표로 컨텍스트를 다시 만들어 G4(본문·numbers_used)·G5·G6 재실행. 배치분은 적재할 때마다 다시 | `logs/phase-3-verify-explain-local.log`, `logs/phase-3-verify-explain-local-v4.log`, `logs/phase-3-load-explain-remote.log`, `gen/test/explain.test.ts`(변조 탐지 시험 포함) |
| 4 | `grep -r "[0-9]" worker/src --include=*.ts`로 금액 상수 하드코딩 없음 | 통과 — 126줄 전부 HTTP 상태·테넌트 bp 임계(8000/9500, 상위 §5 예시값)·쪽 상한·해시 이름·SQL 자리·정규식. 금액 리터럴 0 | `logs/phase-3-grep-digits.log` |
| §12 | 라인 설명 통과율 ≥ 95%, 실패분은 "설명 없음" 배지 | 녹화 LINE 10/10(v4 첫 시도). 배치 전체 통과율은 배치 뒤(배치 미실행 — 위 v4 판정). FAIL·없음은 본문 없이 "설명 없음"(API가 본문을 내보내지 않는다 — 시험) | `worker/test/api.test.ts`, `web/test/explain.test.tsx` |

## 항목별 산출물

| 항목 | 산출물 |
|---|---|
| 1 packages/grounding | `packages/grounding/src/{numbers,context,verifier,DerivedNumbers,index}.ts`, `forbidden.json`. `GroundingVerifier.verify(text, context, {numbersUsed, extra}) → {status, missing, tokens}`, `unknownCitedFields`(G5), `forbiddenViolations`(G6), `gateExplanation`. worker·gen이 workspace 의존(`workspace:*`)으로 import, packages → gen·worker·web 금지(ESLint). `DerivedNumbers`를 worker에서 옮김(+ `requested`·`delta`) — worker는 다시 내보내기 |
| 2 gen/explain | `context.ts`(LINE·LIMIT·MONTH_DIFF 빌더 + 대상 열거), `generate.ts`(요청·G1·G4~G6·재생성 1회), `store.ts`(`data/explain/<hash>/<kind>.jsonl`, 캐시 키 streamHash+promptVersion+kind+subject, G1 `contracts/explain/v1/explanation.schema.json`), `run.ts`(`--stub`·`--record`·`--batch`). 프롬프트 `prompts/explain_{line,limit,month}/v1~v4.md`(활성 v4), `explain_repair/v1.md`, 출력 스키마 `contracts/explain/v1/explanation-llm.schema.json`. 공급자 `providers/groq.ts`(Groq·Workers AI OpenAI 호환), `budget.ts reserveCall(scope, cap)` |
| 3 G4·G5·G6 | 위 `gate()` — 실패는 위반 목록을 붙여 재생성 1회(`explain_repair/v1`), 재실패는 `grounding_status=FAIL` + `failure{g4,g5,g6}`로 저장 |
| 4 적재·재검증 | `load:d1 -- --local\|--remote --explain [--dir]`(`flow.ts loadExplanations` — D1에 없는 키만 INSERT, 스트림이 stream_meta에 있어야 함), `--purge-inactive`가 그 스트림 설명도 지움. `verify:explain`(`explain/recheck.ts`) |
| 5 API·화면 | `/me/earnings/lines/{calcId}`·`/me/limits/{ledgerId}`의 `explanation`, 새 `GET /me/earnings/{ym}/diff`, `/me.promptVersions`(설계서 §7 v0.1.12 규약 — 설명 Phase에서). 활성 버전 `PROMPT_VERSIONS`(wrangler vars, `explain_*=v4` — 처음 v2). 계약 덧씌우기 `Explanation`·`MonthDiffResponse`. 화면: `web/src/explain.tsx`(검증 배지·고정 문구·근거 보기 — 인용 필드 노란 하이라이트·사용된 숫자), 라인 상세 "이 금액이 나온 이유", 한도 상세 "한도 이력 요약", 명세 "전월과 달라진 이유"(펼칠 때 불러옴) |
| D1 | `worker/migrations/0004_explanation_pk.sql`(설계서 v0.1.15) — 로컬 적용 |
| 데이터 | `data/explain/fca1971c…/{line,limit,month_diff}.jsonl` — v4 녹화 16건(실호출 출력, 배치가 같은 키를 건너뛴다. 처음엔 v2), `gen/providers/vcr/explain.json`(v4 17항목) |
| Phase 2 남은 이슈 3 | 소진 바 백분율을 바 바깥 오른쪽으로(`.usage`) — 캡처 `phase-3-demo1-ledger1-explanation.png` |

## 결정·편차

1. **설계 변경 두 번(설계서 먼저)**: v0.1.14(`bb60ec7` — 운영자 결정: 설명 대상 데모 3명·약 600건, 배치 예산, packages/grounding) · v0.1.15(`206227c`) — `explanation` PK `(tenant_id, kind, subject_id, stream_hash, prompt_version)`에 `agent_id`가 없어 MONTH_DIFF(subject = close_ym)가 데모 3명 사이에 충돌한다. PK에 `agent_id`를 넣고, 새 PK가 `(tenant_id, agent_id, kind)`로 시작하므로 `ix_expl_agent`는 지웠다 → 적재 쓰기 약 1,800 → **약 1,200**(운영자 메시지의 "인덱스 1"과 다름). 원격 표는 비어 있어 0004가 다시 만든다.
2. **MONTH_DIFF 88건**: 데모 3명의 월 행 91개 중 각자 첫 달을 뺀 수. 그중 8개 달은 바로 전 달 행이 없다(월 행 사이 빈 달) — 그 달은 `previous.statement: "NONE"`과 비교한다("약 90"에 맞춤. 전월 행이 있는 달만이면 80).
3. **예산 scope**: 운영자 지시 "scope=batch:explain"을 공급자별 상한을 걸 수 있게 `batch:explain:groq`(130)·`batch:explain:workers-ai`(200)로 나눴다(설계서 v0.1.14 §4.1(b)·DECISIONS).
4. **금지어 목록 위치**: PHASES 원문 `gen/verify/forbidden.json` 대신 `packages/grounding/forbidden.json` — Phase 4 런타임(worker)이 같은 목록을 읽어야 하는데 worker → gen import는 금지다(설계서 v0.1.14 §6.1).
5. **통과율 정의**: 80% 관문은 첫 시도 기준으로 판정했다(재생성 뒤 값으로는 v1도 93.8%였지만, 재생성은 호출을 두 번 써서 3일 예산 990회 안에 약 600건이 빠듯해진다).
6. **검증기 보강(녹화 중 발견)**: 대문자 코드(상품 키 `WHOLE-LIFE-20Y`) 안 숫자 제외, NFKC + 서식 문자(U+200B) 제거 — v2 출력에 "RE​NEWAL"(U+200B)이 있었다. 생성기는 정규화한 본문을 저장한다. 금액은 절댓값으로 비교("72만 원 환수" ↔ −720000, 설계서 §6.1에 반영).
7. **화면 2 `basis.rate` 표시**: Phase 2 화면이 "1%"로 그렸으나 상위 계약상 불투명 소수 문자열(표시 전용, 단위 없음)이고 설명은 "요율 1"이라 `%`를 뗐다.
8. **상단 "프롬프트" 칩**: 답변 프롬프트(Phase 4)용이라 자리 그대로. 설명 블록마다 `explain_line/v4`(처음 v2)를 표시하고 `/me.promptVersions`에 활성 버전이 있다.
9. 계약 덧씌우기 `copilot-overlay.json`을 스크립트로 고치며 들여쓰기 형식이 펼쳐졌다(내용 변경은 `promptVersions`·`explanation`·`Explanation`·`MonthDiffResponse`뿐).
10. **활성 버전 v4(2026-10-31)**: 생성기 `PROMPTS`·`PROMPT_VERSIONS`(wrangler vars)·VCR(17항목 — 16 + `#retry` 1)·worker·web 시험 픽스처를 v4로. `data/explain/fca1971c…/`에는 v4 16건만 남겼다(v2는 커밋 `fdee8eb`, v3는 `logs/phase-3-explain-v3-bodies.log`에 본문). gen 시험은 버전 문자열 대신 `promptVersionOf()`를 쓴다.
11. **공급자 구조화 출력 실패(Groq `400 json_validate_failed`)**: 위 녹화 절. 같은 요청 재전송 최대 3회 → 모두 실패면 G1 실패로 재생성·FAIL.
12. **호출 수 집계**: `RunReport.calls`를 공급자에 실제로 보낸 HTTP 요청 수(= 예산 차감 수, 재시도 포함)로 바꾸고 `providerRetries`(사유별)·첫 시도 통과 수·공급자별 통과율(`byProvider` — /evals 모델별 표시용, 행에는 `model`)을 리포트에 넣었다.
13. **Workers AI 인증**: 키가 `gen/.dev.vars`에 없어, `budget.ts`처럼 wrangler 로그인 인증을 Workers AI 호출에도 쓰려고 `wrangler auth token`의 출력 모양을 확인하려 했으나 권한 정책(자격 증명 탐색)에 거부됐다. 우회하지 않았다 — 키는 사람 작업으로 남는다.

## 원격 일정(운영자 지시 — 날짜별 rows_written_24h를 아래 표에 계속 적는다)

| 시각(UTC) | 단계 | rows_written_24h(적재 전 `wrangler d1 info`) | 실측 rows written |
|---|---|---|---|
| 2026-10-30 12:06 | (Phase 2) 0003·demo_agents | 0 | — |
| 2026-10-31 04:56 | `d1 info`(적재 직전) | **24,960**(직전 24시간 — 10-30 Phase 2 쓰기) | — |
| 2026-10-31 04:57 | 새 스트림 `fca1971c…` → 슬롯 b 적재·재검사(월 합산 불일치 0)·전환 | — | **24,824**(추정 24,826, 차이 −0.01%) |
| 2026-10-31 04:57 | `/api/v1/health` → `streamHash fca1971c…`, `earningsLines 5200` | — | — |
| 2026-10-31 05:00 | 0004 `--remote`(원격 `explanation` 0행 확인 뒤, PK에 agent_id·자동 인덱스 1) | — | (DDL 3문장) |
| 2026-10-31 05:17 | v4 녹화 16건 적재 → `verify:explain --remote` 16행 위반 0 | 0(05:16 조회 — 집계 지연) | **32**(16행 × 2, v0.1.15 계산과 같음) |
| 2026-10-31 05:18 | `d1 info` | **49,836**(= 24,960 + 적재 24,824 + 설명 32 + 0004·budget_counter 약 20) | — |
| 2026-11-01 00:00 이후 | 슬롯 a 퍼지(구 스트림 e2e435e7…, 설명 0행) | | |

- 실측/추정: 스트림 적재 24,824 / 24,826, 설명 32 / 32 — 10% 이내라 설계서 §5.3 계산은 그대로 둔다. `d1 info`의 `rows_written_24h`는 직전 24시간 누적이라(05:18 값에 전날 24,960이 들어 있다) 무료 한도(UTC 하루 10만)와 맞출 때는 적재기 실측 합을 쓴다 — 10-31 UTC 쓰기 약 24,876. 05:16 조회의 0은 집계 지연으로 보인다(2분 뒤 49,836).
- 로그: `logs/phase-3-load-remote-slot-b.log`, `logs/phase-3-remote-0004.log`, `logs/phase-3-load-explain-remote.log`. 배포된 Worker는 아직 Phase 2 코드(`f87c551c`)라 설명 API는 푸시·CI 배포 뒤에 원격에서 보인다.
| 2026-11-01 00:00 이후 | 슬롯 a 퍼지(구 스트림 e2e435e7…, 설명 0행) | | |

## 설명 배치(미실행 — 운영자 판정 대기)

운영자 규칙(2026-10-31): 하루 Groq 130 + Workers AI 200, LINE → LIMIT → MONTH_DIFF. 첫날 첫 호출로 Workers AI `gpt-oss-20b`의 `json_schema` 구조화 출력을 확인하고, 미지원이면 프롬프트 강제 JSON + G1로 폴백하고 여기에 적는다. 날마다 `data/explain/<hash>/`에 커밋하고 통과율(첫 시도·재생성 후)·공급자별 호출 수·FAIL 목록을 아래 표에. 최종 라인 통과율이 §12 기준 95% 미만이면 FAIL분을 모아 보고하고 재생성은 운영자가 정한다. 행의 `model`은 유지(/evals 모델별 통과율).

| 날짜(UTC) | 공급자별 호출(HTTP) | 생성 | 첫 시도 통과 | 재생성 후 통과 | FAIL 목록 | rows written |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

명령(승인 뒤): `cd gen && pnpm run explain -- --batch` → `git add data/explain` 커밋 → `pnpm run load:d1 -- --remote --explain` → `pnpm run verify:explain -- --remote`. 남은 대상 575건(591 − 녹화 16).

## 사람 작업

- [ ] **배치 관문 판정**: v4 #2 "다음 회계연도로 이연"을 4종 안으로 볼지(→ 지시대로 멈춤, v5 여부 결정) 밖으로 볼지(→ v4로 배치) — 담당: 운영자
- [ ] Workers AI 배치 키: `gen/.dev.vars`에 `CLOUDFLARE_API_TOKEN`(Workers AI 권한)·`CLOUDFLARE_ACCOUNT_ID` — 없으면 배치는 Groq 130/일만 돌아 약 5일(있으면 약 2일), 첫날 `json_schema` 확인도 못 한다. wrangler 로그인 인증으로 대신하는 방법은 권한 정책에 거부됐다(결정·편차 13). 커밋 금지(규약 10) — 담당: 운영자

## 남은 이슈

1. **뜻 품질(G4~G6 밖)**: v2의 4종(부호·날짜·코드·용어집 숫자)은 v3·v4에서 없앴다(위 점검표). v4에 남은 것: "다음 회계연도로 이연"(#2, 관문 경계), 전기 뒤 누적을 "현재까지"(#4), 계산 근거 서술(#7). 배치 575건의 뜻은 사람이 다 읽지 못한다 — 기계 점검(정규식)을 배치 결과에 돌려 날짜별 표에 참고로 붙이고, 내용 일치는 Phase 6 평가 몫.
2. 배치 출력은 `openai/gpt-oss-120b`(Groq)와 `@cf/openai/gpt-oss-20b`(Workers AI)가 섞인다 — 같은 프롬프트 버전이라 행의 `model`로 구분. Workers AI 쪽 OpenAI 호환 구조화 출력(json_schema)·`reasoning_effort`는 배치 첫날 첫 호출로 확인한다(키 필요, 미실행). Workers AI 4006(하루 무료 뉴런 소진) 응답의 모양도 그때 보고 `BudgetExhausted`로 다룬다.
