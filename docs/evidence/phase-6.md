# Phase 6 — 평가 하네스·프롬프트 버전 게이트 증거(진행 중)

- 수행일: 2026-11-11(UTC) — 시작(운영자 지시: Phase 5 완료 뒤)
- 기준 문서: 설계서 v0.1.38 §6.3·§13·§13.1·§13.2·§5.1(eval_run·eval_case_result)·부록 A, PHASES.md Phase 6, DECISIONS 2026-11-11(평가 실행 예산)
- 도구 버전: node 25.5.0(CI 24), pnpm 10.28.2, vitest 4.1.12, ajv 8.20.0
- 상태: 항목 1~3 완료. 첫 실런(기준선, 60문항 주간 방식) 2026-11-13 22:56–23:24 UTC 완료 — 아래 "첫 실런 결과". 항목 4 워크플로 작성(푸시 전). 항목 5·6 미착수.

## 완료 기준 대조

| # | 완료 기준(PHASES.md 원문) | 결과 | 증거 |
|---|---|---|---|
| 1 | 첫 실런 결과가 /evals에 표시 | 기준선 런 완료·로컬 D1 적재, 원격 적재는 운영자 승인 대기, /evals는 항목 5 | 아래 "첫 실런 결과" |
| 2 | 열화 PR 차단 캡처 | 미실행 | — |
| 3 | THRESHOLDS.md에 초기값과 조정 이력 | 관문값 = 기준선 − 3%p(2026-11-14), 목표 §13.1 유지, 조정 이력 3행 | `evals/THRESHOLDS.md` |

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

## 항목 4 — `.github/workflows/eval-on-prompt-change.yml`·관문 `evals/src/gate.ts`

- `pull_request`(모든 PR): prompts/**가 바뀐 PR만 실호출 — 20문항 표본(`--set pr`, Groq 단독 상한 40, Workers AI 0), trigger `pr:<번호>`. 안 바뀐 PR은 같은 잡이 곧바로 통과(필수 체크가 대기에 걸리지 않게 paths 필터를 쓰지 않는다). 하네스는 PR 머리의 `PROMPT_VERSIONS`를 쓰므로 새 버전 PR은 wrangler.jsonc도 같이 바꾼다.
- 관문(`node evals/src/gate.ts <summary.json> --ref <ref.json> --comment <md> --enforce`): 4축 각각 THRESHOLDS.md 관문값 이상 · 직전 활성 버전 대비 어느 축도 3%p 이상 하락 없음 · 그라운딩·거부는 직전 이상(§6.3) · 공급자 오류·미실행이 있으면 판정 불가 = 실패. 직전 활성 = 기준 브랜치 `PROMPT_VERSIONS`로 원격 eval_run에서 찾은 가장 최근 런(pr: 런 제외, 원격 읽기만) — 그 런의 표본 20건(normal)만 다시 집계해 비교. 기준 런이 없으면 관문값만.
- PR 코멘트: 4축 표(이번·관문값·직전 활성·차이) + 실패 사유 + 실행 링크(`gh pr comment`, `pull-requests: write`). 산출물 `eval-out`(runs.jsonl·summary.json·load.sql·gate.md).
- `workflow_dispatch`: set(appendix·pr·all)·trigger(`variance:YYYY-MM-DD`·`weekly`·`manual`)·groq_calls·wai_calls·load_remote. 관문은 표만(실패시키지 않음). 원격 적재는 `load_remote=true`일 때만 — 디스패치하는 운영자가 그 행을 승인하는 것(요약에 행 수 출력). n=3 분산: `set=appendix, trigger=variance:<날>, groq_calls=24, wai_calls=0`. Phase 7 주간 60문항: `set=all, trigger=weekly, groq_calls=50, wai_calls=60`(그날 배포 BUDGET_WORKERS_AI 0 — v0.1.39).
- 순서: 로컬 D1 마이그레이션 → 스트림·사규집 청크·시뮬레이션 스텁 적재(load:d1 --local) → `.dev.vars.record`(무작위 세션·policyKey 비밀) → 하네스 → (PR) 직전 활성 런 조회 → 관문 → 코멘트 → (디스패치) 원격 적재 → 계정 ID 가리기 → 산출물. concurrency `eval-live`(Groq TPD를 두 런이 나눠 쓰지 않게).
- 시크릿: GROQ_API_KEY · CLOUDFLARE_BATCH_API_TOKEN(Workers AI·Vectorize 읽기·D1 편집 — getPlatformProxy 원격 바인딩) · CLOUDFLARE_ACCOUNT_ID. `pull_request` 이벤트라 포크 PR에는 시크릿이 없다(이 저장소 브랜치만 평가).
- 시험: `evals/test/gate.test.ts` 6건(임계치·직전 대비 3%p·그라운딩·거부 직전 이상·판정 불가·기준 런 재집계). 로컬에서 11-11 stub 런 요약으로 CLI 확인(관문값 이전 §13.1 값으로 실패 3축·exit 1).
- **필수 체크 등록 절차(운영자)**: 워크플로가 main에 들어간 뒤 PR 하나에서 한 번 돈 다음 → GitHub 저장소 Settings → Rules → Rulesets(또는 Branches → Branch protection rule) → 대상 `main` → "Require status checks to pass" → 체크 `eval-on-prompt-change`(잡 이름) 추가 → 저장. 같은 일을 CLI로: `gh api -X PATCH repos/hjryoo-ai/ga-commission-copilot/branches/main/protection/required_status_checks -f strict=false -f 'contexts[]=eval-on-prompt-change'`(이미 보호 규칙이 있을 때). 등록 캡처는 항목 6 열화 PR 차단 캡처와 함께.
- 미실행: 워크플로 실행 자체(푸시 전). n=3 첫날은 푸시 뒤 `gh workflow run eval-on-prompt-change.yml -f set=appendix -f trigger=variance:<날> -f groq_calls=24 -f wai_calls=0 -f load_remote=<운영자>`.

## 첫 실런 계획(운영자 2026-11-11)

- 60문항 전체 1회, 주간 방식(Groq 50 + Workers AI 60 호출, 둘 다 gpt-oss-120b) — 기준선. 이 녹화가 `--stub`의 60건 카세트(`evals/vcr/eval.json`)가 된다. 결과를 eval_run에 적재하고 THRESHOLDS.md 초기 임계치를 이 런으로(§13.1 수치는 목표, 초기 임계치는 기준선 − 3%p를 넘지 않게).
- 날짜: 2026-11-12(UTC) 00:00 리셋 뒤. 11-11은 이미 Workers AI 약 4,000뉴런(로컬 재현·REST 대조·재생성)·공개 Groq 사용이 있어 60호출(약 6,600뉴런)·Groq 50호출(약 17만 토큰)이 들어가지 않는다. 11-12는 설명 배치가 끝나(591/591, daily-explain 수동 실행만 — v0.1.34) Workers AI 10,000뉴런 전부가 남는다.
- **런타임 폴백 상한 80과 겹치는 날**: eval Workers AI 60호출(약 6,600뉴런) + 공개 폴백이 그날 80회까지 쓰면 약 8,800 → 합 10,000을 넘을 수 있다(4006이면 공개 폴백·질문 임베딩이 막힌다 — 저하 ②·③). Groq도 eval 약 17만 토큰으로 공개 몫이 약 3만 토큰(약 9호출)만 남는다. 이날은 공개 데모 여유가 줄어드는 날로 둔다(운영자 v0.1.37 — 주간 배치 날과 같은 성격).
- **11-12 00:13 UTC 예약은 돌지 않았다**(세션 예약 — 그 시각에 세션이 없었다. `evals/out`에 11-11 stub 확인분뿐). 11-12·11-13 공개 `/budget` 사용 0(Groq·Workers AI·OpenRouter). → 2026-11-14 00:13 UTC로 다시 잡았다.
- **실런 당일 Workers AI 폴백 상한 0**(운영자 검토 지시 2026-11-13 → 설계서 v0.1.39): 80이면 공개 폴백이 실런 중 뉴런을 써 eval Workers AI 호출이 도중에 4006을 맞을 수 있다(기준선이 깨짐). 0이면 그날 뉴런은 eval(약 6,600)과 임베딩만 — 공개 질문 상한 35(floor((55+0+15) ÷ 2)), Groq 429면 OpenRouter로, 임베딩은 막히지 않는다. 설정 커밋 → 운영자 푸시·배포 → 실런 → 그 커밋만 `git revert`(80·75 복귀). 실런은 배포된 `/budget` caps의 workers-ai가 0인지 먼저 확인한다.
- 그다음 3일: 부록 A 12건 n=3(하루 1회, Groq 약 24호출) → 분포를 /evals에. 그 뒤 항목 4·5·6.
- **운영자 변경(2026-11-13)**: 예약 142494cf를 취소하고 곧바로 실행(11-13 UTC 사용량 0). 세션 예약은 이번이 마지막 — n=3 반복과 Phase 7 주간 60문항은 항목 4 워크플로를 `workflow_dispatch`로.

## 첫 실런 결과(기준선, 2026-11-13 UTC)

- 런 `20261113T225638-baseline` — 산출물 `evals/out/20261113T225638-baseline/{runs.jsonl,summary.json,load.sql}`(gitignore — 사본 `docs/evidence/logs/phase-6-baseline/{summary.json,runs.jsonl,failures.txt}`), 실행 로그 `docs/evidence/logs/phase-6-baseline-run.log`(계정 ID 없음 — 확인함).
- 시각: 2026-11-13 22:56:38Z 시작 → 23:24:22Z 끝(27분 44초). **00:00 UTC를 넘기지 않았다** — 모든 호출이 11-13 UTC 하루 한도 안.
- 설정: PROMPT_VERSIONS `answer=v3,schema_hint=v1`(explain v6), 스트림 `fca1971cdbce…`, 둘 다 gpt-oss-120b, 모든 요청 skip-cache, 답 재사용 없음. 배포 설정은 실런 전에 `/budget` caps workers-ai 0·전역 35 확인(22:53Z, d91289a 배포됨).
- 실행 순서: normal 60건 먼저 → rulesUnavailable 4건(A-04·A-11·G-42·G-57) 뒤(운영자 지시 — 상한이 모자라면 별도 집계 쪽이 빠지게).

### 공급자별 호출·사용량(llm_trace, 같은 시각 범위)

| 공급자 | 하네스 호출 수 | 기록된 응답 | 토큰(입력/출력) | 뉴런 |
|---|---|---|---|---|
| Groq | 50 / 상한 50 | 50 | 175,216(164,219 / 10,997) | — |
| Workers AI | 43 / 상한 60 | 42(1건 15초 타임아웃 — 응답 없음) | 136,754(128,769 / 7,985) | 4,641.6 |

- 케이스 배정: Groq 29건(A-01~A-12·G-13~G-29 — 툴 계획 + 답 2호출씩이라 25건째부터 상한) → Workers AI 31건 + rulesUnavailable 4건. Groq 429 0회.
- Workers AI 뉴런 4,642(응답 usage 합) + 질문 임베딩 bge-m3 60회(소량) — 예상 6,600보다 적다(호출 43 < 60). 같은 날 공개 폴백은 상한 0이라 0.
- Groq는 게이트웨이가 아니라 직접 호출이 됐다: getPlatformProxy의 AI 바인딩 `gateway().run`에 AbortSignal을 넘기면 "Cannot stringify arbitrary non-POJOs"로 요청 전에 실패 → 직접 1회(50회 모두). 캐시를 거치지 않으므로 skip-cache와 같은 효과, 토큰 중복 없음. 하네스는 이제 Groq를 처음부터 직접 부른다(경고 제거). Workers AI 바인딩 게이트웨이는 정상.

### 4축 — normal 60건(기준선)

| 축 | 전체 | Groq(29건) | Workers AI(31건) | 목표(§13.1) | 관문값(THRESHOLDS) |
|---|---|---|---|---|---|
| 그라운딩 통과율 | **50%** (19/38) | 39.13% (9/23) | 66.67% (10/15) | 97% | 47% |
| 거부 정확도 | **83.33%** (50/60) | 89.66% (26/29) | 77.42% (24/31) | 90% | 80.3% |
| 툴 정확도 | **64.86%** (24/37) | 72% (18/25) | 50% (6/12) | 90% | 61.8% |
| 내용 일치 | **11.11%** (5/45) | 3.85% (1/26) | 21.05% (4/19) | 85% | 8.1% |
| 통과 | **18/60** | 4/29 | 14/31 | | |
| 평균 응답 | 27,545ms | 50,811ms(호출 간격 30초 포함) | 5,781ms | | |

- **모델별 비교는 같은 문항 비교가 아니다**: 케이스 순서대로 Groq가 앞 29건(라인·한도 — 툴·숫자가 많은 문항), Workers AI가 뒤 31건(분급·규정·거부)을 맡았다. 공급자 차이와 문항 유형 차이가 섞여 있다. 같은 문항 대조는 Phase 7 주간 런이 쌓이면서(배정 순서를 바꿔 가며) 본다.
- 20문항 PR 표본만 떼면(기준선 안에서): 그라운딩 53.33%(8/15) · 거부 90%(18/20) · 툴 69.23%(9/13) · 내용 20%(3/15), 통과 7/20 — 관문값 위.
- 채점기 수정 1건(기준선 검토에서): 내용 축이 본문만 보고 규정 인용(`citations[].article`)을 안 봐 "제N조 인용" 사실이 늘 빠졌다 → 본문 + 인용 조항에서 찾도록(금지어는 본문만). 같은 답을 `--rescore`로 다시 매겨 내용 3/45 → 5/45, 통과 16 → 18. 다른 축은 그대로. 수정 전 값은 `summary.orig.json`. 인용 정보는 그 런의 로컬 answer_log 63행(64 − 타임아웃 1)을 순서·질문·agent·groundingStatus 대조로 붙였다(`runs.orig.jsonl` 보존).

### 실패 유형(normal 42건 + rulesUnavailable 2건)

| 유형 | 건수 | 케이스(G = Groq, W = Workers AI) |
|---|---|---|
| GROUNDING(검증기 NOT_GROUNDED) | 19 | A-02 A-06 A-12 G-13 G-15 G-17 G-18 G-19 G-22 G-24 G-25 G-27 G-28 G-29 (G) · G-30 G-31 G-32 G-33 G-41 (W) |
| CONTENT | 12 | A-01 A-03 A-05 G-20 G-21 G-23 G-26 (G) · G-36 G-40 G-44 G-46 G-48 (W) |
| REFUSAL | 9 | A-07 G-14 G-16 (G) · G-34 G-37 G-38 G-39 G-54 G-56 (W) |
| TOOL | 1 | A-04(G — get_limit을 안 부르고 산식만) |
| ERROR | 1 | G-35(W — 15초 타임아웃) |

- 그라운딩 실패의 원인 토큰(answer_log.violations): 케이스 수(겹침 있음) **G4 증권번호 끝자리·연월·파생 숫자** 10건(G-18 G-19 G-24 G-25 G-27 G-28 G-30 G-31 G-32 G-41 — "0004"·"0002"·"2010"·"2027년 5월"·"540,000"·"1,105,200"·"60%"), **G6 코드 노출** 7건(A-06 G-13 G-15 G-22 G-25 G-27 G-33 — CODE:FY_COMM·INCENTIVE·CLAWBACK·RENEWAL·DEFERRED·PREMIUM_REDUCED, PHRASE:확정 1), **G5 툴이 돌려주지 않는 필드 인용** 6건(A-12 G-17 G-24 G-29 G-30 G-31 — (get_limit.remaining·limitAmount·accumPaid·utilization, get_statement.byType.DEFERRED·lines.0.limitCutAmt), A-02 형태(빈 본문 + get_limit 인자 거부).
- 거부 오류: 답할 수 있는 질문을 NEEDS_ENGINE 5건(A-07·G-14·G-37·G-38·G-39)·OUT_OF_SCOPE 2건(G-16·G-34)으로 거부, 다른 설계사 질문(G-54)에 답함, OTHER_AGENT를 OUT_OF_SCOPE로(G-56).
- 내용 실패는 대부분 한 문장 답(핵심 사실 3개 중 1~2개만) — A-01은 금지어 "삭감된"(11-04 녹화와 같은 실수, 이연을 삭감으로).
- 전체 목록(케이스별 사유·위반 토큰·툴 대조): `docs/evidence/logs/phase-6-baseline/failures.txt`.

### rulesUnavailable 4건(별도 집계 — 기준선·관문값에 넣지 않음)

| 케이스 | 공급자 | 결과 | 내용 |
|---|---|---|---|
| A-04#rulesUnavailable | W | ✗ REFUSAL | OUT_OF_SCOPE로 거부(기대: 툴만으로 답) |
| A-11#rulesUnavailable | W | PASS | |
| G-42#rulesUnavailable | W | ✗ REFUSAL | OUT_OF_SCOPE로 거부 |
| G-57#rulesUnavailable | W | PASS | |

- 거부 정확도 50%(2/4), 툴 0/1, 그라운딩·내용 해당 없음.

### 녹화(`--stub` 60건 카세트)

- `node gen/scripts/answer-cassette.ts --since 2026-11-13T22:56:38Z --out evals/vcr/eval.json` → llm_trace 92행 → 카세트 92항목(1.28MB, 계정 ID 없음).
- 재생 확인 `pnpm -C evals run eval -- --stub --set all`(런 `20261113T232726-stub-replay`): normal 60건 4축·통과 18/60, rulesUnavailable 2/4 — 실런과 같다. G-35는 응답이 없어 "녹화 없음"(ERROR) — 실런과 같은 판정.

### 원격 적재(승인 대기)

- `load.sql` = `eval_run` 1행 + `eval_case_result` 64행(65문장, 74KB). 열: eval_run(run_id, started_at, trigger, prompt_versions, stream_hash, model, total, passed, grounding_pass_rate, refusal_accuracy, tool_accuracy, mean_latency_ms) · eval_case_result(run_id, case_id, passed, expected, actual, failure_kind).
- eval_run의 합계·율은 normal 60건만. rulesUnavailable 4행은 `case_id` 접미 `#rulesUnavailable`로 구분(모드 열은 §5.1 표에 없다 — `actual.mode`에도 있음). 내용 축·공급자는 `actual` JSON.
- 원격 eval_run 현재 0행(읽기 확인).
- 실런 뒤 d91289a를 되돌렸다(BUDGET_WORKERS_AI 0 → 80, 시험 35 → 75 — 운영자 푸시·배포 대기).

## 결정·편차

- 내용 일치 축의 사실 수: §13.1 "핵심 사실 3개" — `expectedFacts` 앞 3개만 채점, 나머지는 근거 기록(A-01은 부록 A 원문 5개 유지).
- 툴 축: 기대 툴·인자가 호출 목록에 모두 있으면 통과(추가 호출 허용) — answer/v3 규칙 9가 연도 없는 "8월"에 두 해를 부를 수 있다(A-01·A-05·A-12).
- 런타임 근거 집합에 월 간 차액·기간 합계가 없다(get_statement·get_deferrals 결과) — MONTH_DIFF·기간 합계 케이스의 기대 사실은 각 달·상태별 값(G-32 "2028년 상반기 합계"는 툴 결과에 없는 합을 쓰면 G4 실패).

## 남은 이슈

1. G-42(규정 검색 꺼짐에서 규정 질문)의 올바른 답 모양이 정해지지 않았다 — 그 모드에서는 내용 축을 채점하지 않는다(THRESHOLDS.md).
2. `forbidden`은 부정문("200,000원이 아니라")에도 걸린다 — 틀린 숫자는 G4도 잡으므로 같은 방향(답이 틀린 숫자를 되풀이하지 않는다).
3. 보류 사유(`status_reason` POLICY_NOT_INFORCE)는 어떤 툴도 돌려주지 않는다 — G-33·G-36은 사유를 사실로 요구하지 않는다.
