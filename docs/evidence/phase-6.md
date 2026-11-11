# Phase 6 — 평가 하네스·프롬프트 버전 게이트 증거(진행 중)

- 수행일: 2026-11-11(UTC) — 시작(운영자 지시: Phase 5 완료 뒤)
- 기준 문서: 설계서 v0.1.38 §6.3·§13·§13.1·§13.2·§5.1(eval_run·eval_case_result)·부록 A, PHASES.md Phase 6, DECISIONS 2026-11-11(평가 실행 예산)
- 도구 버전: node 25.5.0(CI 24), pnpm 10.28.2, vitest 4.1.12, ajv 8.20.0
- 상태: 항목 1(60문항)·항목 2(하네스)·항목 3(채점) 완료(LLM 없이 stub 확인). 첫 실런(60문항, 주간 방식)은 2026-11-12 00:00 UTC 리셋 뒤.

## 완료 기준 대조

| # | 완료 기준(PHASES.md 원문) | 결과 | 증거 |
|---|---|---|---|
| 1 | 첫 실런 결과가 /evals에 표시 | 미실행(하네스 전) | — |
| 2 | 열화 PR 차단 캡처 | 미실행 | — |
| 3 | THRESHOLDS.md에 초기값과 조정 이력 | 초기값 기록(2026-11-11) — 첫 런 뒤 조정 | `evals/THRESHOLDS.md` |

## 항목 1 — 골든 60문항(`evals/cases.jsonl`)

- 구성(§13.2): 라인 15 · 한도 12 · 분급 8 · 규정 10 · 거부 15, 오답 유도 8(A-12·G-19·G-21·G-22·G-25·G-29·G-31·G-38). 부록 A 12건(데모 1) 그대로 + G-13~G-60(대부분 데모 2 A-1002 분급제·데모 3 A-1003 재산정, 거부는 세 설계사에 5건씩). 거부 사유 OUT_OF_SCOPE 6(요율표·지급률표·시책표 전부 3 포함)·OTHER_AGENT 4·NEEDS_ENGINE 5.
- 운영자 지정 항목(2026-11-11)을 케이스로: 관계 오류 "절반·두 배"(G-18 — 11-03 c-A1002-15-1 사례, G-19 오답 유도, G-34·G-38·G-41·G-27), 조정/재산정 vs 전기(G-24·G-25·G-26·G-43·G-59), 음수 잔여(G-24·G-31·G-44 — `forbidden` "-60,000"·"마이너스", G4는 부호를 떼므로 내용 축만 잡는다), MONTH_DIFF(A-06·G-13~G-17 — 배치 첫 시도 76.5%), rulesUnavailable 모드(A-04·G-42·A-11·G-57), 삭감 vs 이연(A-01·A-02·A-12).
- 계약 `contracts/eval/v1/case.schema.json`(앞 3개 = 핵심 사실, forbidden, 툴 축은 포함 판정, modes). 근거표 `evals/FACTS.md`(사실마다 D1 표·행·열 또는 스트림 seq·조항 — 데모 세계 seq와 부록 A 상위 seq 대응 포함).
- 초안은 에이전트가 로컬 D1 읽기 전용 SELECT로 만들고, 검토에서 바꾼 것: A-01 핵심 사실 3개(지급 855,000·한도 초과 145,000·사유 이연)를 앞으로, 사유 매칭에서 "한도" 제외(어느 답이나 맞는다), A-01·A-02 "삭감·깎였다" 금지 — 원장 `deferred_total` 145,000·`cut_total` 0·정책 DEFER_AFTER_FY(운영자 "삭감 vs 이연" 케이스). 표본 대조(G-15·G-18·G-24/G-31·G-32)는 D1 값과 같다.
- PR 표본 `evals/pr-sample.json`(v0.1.37): 부록 A 12 + 층화 8(line G-15·G-18 · limit G-31 · deferral G-32 · rule G-43·G-45 · refusal G-54·G-58 — 최대 나머지 비례 배분, 시험이 재계산).
- 시험: `evals/test/cases.test.ts` 6건(계약·순서·구성·거부 코드·부록 A 질문 일치·지정 항목·표본) 통과.

## 항목 2·3 — 하네스 `evals/src/run.ts`·채점 `evals/src/score.ts`

- 런타임 동일: `/ask`를 부르지 않고 worker `answerQuestion`을 그대로 import(esbuild로 묶음 — `.md` 텍스트·JSON, wrangler external: `pnpm -C evals run eval -- --live|--stub …`). 바인딩은 wrangler `getPlatformProxy`(worker/wrangler.jsonc `env.record`, 비밀 `worker/.dev.vars.record`, 상태 `worker/.wrangler/state/v3` — wrangler dev와 같은 로컬 D1), `--live`면 AI·Vectorize 원격.
- 캐시(운영자 2026-11-11 보충, 설계서 v0.1.38): 모든 LLM 요청에 `skipCache` → Groq·OpenRouter 게이트웨이 헤더 `cf-aig-skip-cache: true`(캐시 키·TTL 없음), Workers AI 바인딩 `gateway: {id, skipCache: true}`. 카세트 해시(requestBody)는 그대로(시험). 답 단위 재사용(`reuseAnswer`)은 부르지 않는다.
- 공급자(v0.1.37 주간 방식): 케이스마다 하나로 고정 — 남은 eval 상한이 2호출 이상인 쪽, Groq 먼저(`--groq-calls 50`·`--wai-calls 60`), 한 케이스 안에서 섞지 않는다. Groq는 호출 간격 30초(TPM 8K)·429는 Retry-After만큼 기다려 같은 공급자로 다시(최대 4). 상한이 모자라면 그 케이스는 "예산 — 미실행"(ERROR).
- 모드: `rulesUnavailable` 케이스는 임베딩을 실패시켜 한 번 더(저하 ③ 경로 그대로).
- 기록: `evals/out/<runId>/runs.jsonl`·`summary.json`(4축 전체·공급자별·rulesUnavailable)·`load.sql`(원격용) + 로컬 D1 `eval_run`·`eval_case_result`(내용 축·공급자는 `actual` JSON — §5.1 표에 열 없음). 녹화는 `LLM_TRACE=1`(.dev.vars.record) → llm_trace → `node gen/scripts/answer-cassette.ts --since <시각> --out evals/vcr/eval.json`.
- 채점(§13.1, THRESHOLDS.md와 같은 정의): 그라운딩 = groundingStatus PASS/FAIL(모델 거부 NONE은 분모 밖 — 검증기가 막은 NOT_GROUNDED는 여기서 실패), 거부 = 모델 거부(NONE)의 사유 코드, 툴 = 기대 툴·인자 ⊆ 호출(증권번호 끝 4자리), 내용 = 핵심 사실 앞 `coreFacts`개(기본 3)·`forbidden` 없음(공백 무시, rulesUnavailable·거부 정답은 해당 없음).
- 검토 반영(stub 확인에서): A-02 "지급 예정월 데이터로 확인되지 않음" 매칭에 "명시되어 있지 않"·"확인할 수 없" 추가, A-12 핵심 사실은 부록 A대로 145,000 정정 1개(`coreFacts` 1 — 초안이 덧붙인 855,000·1,000,000은 채점 밖).
- stub 확인(2026-11-11 12:16Z, 카세트 = Phase 4 부록 A 녹화 `worker/test/vcr/answer.json` 2026-11-04 Groq): 12건 끝까지 돈다 — 녹화 없는 rulesUnavailable 2건은 "녹화 없음". 11-04 Groq A-01 답도 "145,000원 삭감된 결과"로 내용 축 실패(금지어 — 의도대로). 기준선이 아니다(카세트가 옛 녹화·12건뿐).
- 시험: `evals/test/score.test.ts` 7건 + cases 6건, worker `cache.test` skipCache 1건. `pnpm -r test` 전체 통과(evals 13 · worker 436 · web 62 · gen 208 · grounding 68), lint 0, evals tsc 0.

## 첫 실런 계획(운영자 2026-11-11)

- 60문항 전체 1회, 주간 방식(Groq 50 + Workers AI 60 호출, 둘 다 gpt-oss-120b) — 기준선. 이 녹화가 `--stub`의 60건 카세트(`evals/vcr/eval.json`)가 된다. 결과를 eval_run에 적재하고 THRESHOLDS.md 초기 임계치를 이 런으로(§13.1 수치는 목표, 초기 임계치는 기준선 − 3%p를 넘지 않게).
- 날짜: 2026-11-12(UTC) 00:00 리셋 뒤. 11-11은 이미 Workers AI 약 4,000뉴런(로컬 재현·REST 대조·재생성)·공개 Groq 사용이 있어 60호출(약 6,600뉴런)·Groq 50호출(약 17만 토큰)이 들어가지 않는다. 11-12는 설명 배치가 끝나(591/591, daily-explain 수동 실행만 — v0.1.34) Workers AI 10,000뉴런 전부가 남는다.
- **런타임 폴백 상한 80과 겹치는 날**: eval Workers AI 60호출(약 6,600뉴런) + 공개 폴백이 그날 80회까지 쓰면 약 8,800 → 합 10,000을 넘을 수 있다(4006이면 공개 폴백·질문 임베딩이 막힌다 — 저하 ②·③). Groq도 eval 약 17만 토큰으로 공개 몫이 약 3만 토큰(약 9호출)만 남는다. 이날은 공개 데모 여유가 줄어드는 날로 둔다(운영자 v0.1.37 — 주간 배치 날과 같은 성격).
- 그다음 3일: 부록 A 12건 n=3(하루 1회, Groq 약 24호출) → 분포를 /evals에. 그 뒤 항목 4·5·6.

## 결정·편차

- 내용 일치 축의 사실 수: §13.1 "핵심 사실 3개" — `expectedFacts` 앞 3개만 채점, 나머지는 근거 기록(A-01은 부록 A 원문 5개 유지).
- 툴 축: 기대 툴·인자가 호출 목록에 모두 있으면 통과(추가 호출 허용) — answer/v3 규칙 9가 연도 없는 "8월"에 두 해를 부를 수 있다(A-01·A-05·A-12).
- 런타임 근거 집합에 월 간 차액·기간 합계가 없다(get_statement·get_deferrals 결과) — MONTH_DIFF·기간 합계 케이스의 기대 사실은 각 달·상태별 값(G-32 "2028년 상반기 합계"는 툴 결과에 없는 합을 쓰면 G4 실패).

## 남은 이슈

1. G-42(규정 검색 꺼짐에서 규정 질문)의 올바른 답 모양이 정해지지 않았다 — 그 모드에서는 내용 축을 채점하지 않는다(THRESHOLDS.md).
2. `forbidden`은 부정문("200,000원이 아니라")에도 걸린다 — 틀린 숫자는 G4도 잡으므로 같은 방향(답이 틀린 숫자를 되풀이하지 않는다).
3. 보류 사유(`status_reason` POLICY_NOT_INFORCE)는 어떤 툴도 돌려주지 않는다 — G-33·G-36은 사유를 사실로 요구하지 않는다.
