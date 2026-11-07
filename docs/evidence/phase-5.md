# Phase 5 — 예산·폴백·캐시·봇 방지 증거(진행 중)

- 수행일: 2026-11-06(UTC) — 시작(운영자 지시: Phase 4 수용 뒤 PHASES Phase 5 항목 1~7, 폴백 체인 Groq → Workers AI gpt-oss-120b → OpenRouter)
- 기준 문서: 설계서 v0.1.33 §6.2·§6.4·§7 저하 모드·레이트 리밋·§9 남용 방지·§10.1·§10.2·§10.4, PHASES.md Phase 5
- 도구 버전: node 25.5.0(CI 24), pnpm 10.28.2, wrangler 4.153.0, vitest 4.1.12
- 상태: **항목 1~6 구현(LLM 호출 없음 — 시험은 가짜 공급자·가짜 게이트웨이·가짜 Siteverify·로컬 D1)** + 레이트 리밋(WAF 대체). 원격 반영(푸시·배포)은 운영자. 완료 기준의 실호출(Groq 429 유도 → Workers AI 폴백 캡처, 구조화 출력 모양 기록)은 폴백 상한이 열리는 11-08 설명 배치 끝 뒤.

## 완료 기준 대조

| # | 완료 기준(PHASES.md 원문) | 결과 | 증거 |
|---|---|---|---|
| 1 | 테스트 통과 | 진행 — 항목 1~6·레이트 리밋 시험 통과(아래) | `worker/test/budget.test.ts`·`fallback.test.ts`·`ask.test.ts`·`cache.test.ts`·`turnstile.test.ts`·`api.test.ts`, `web/test/budget.test.tsx`·`ask.test.tsx`·`App.test.tsx` |
| 2 | /budget에 공급자별 사용·폴백 분포 표시 | 구현(로컬 캡처, 값 0) — 원격은 푸시·배포 뒤 | `captures/phase-5-screen6-budget-local.png` |
| 3 | 실호출로 Groq 429 1회 유도 후 Workers AI 폴백 기록 캡처 | **대기** — `BUDGET_WORKERS_AI=0`(설명 배치와 뉴런 나눔, 설계서 v0.1.27) → 11-08 배치 591/591 뒤 80으로 바꾸는 커밋 다음 | — |
| 4 | 공개 URL에서 사람이 브라우저로 Turnstile 통과 → 자유 질문 1건 답까지 1회 캡처(운영자 2026-11-07 추가) | **통과**(운영자 캡처 2026-11-07) — 아래 "공개 URL 브라우저 캡처" | `captures/phase-5-public-browser-ask.png`·`captures/phase-5-public-budget.png` |

## 운영자 결정(2026-11-06)

- 운영자 값: AI Gateway 이름 `copilot`, Turnstile 사이트 키 `0x4AAAAAAF2LyuLvbqeCCVE5`(공개 값 — wrangler.jsonc var), `TURNSTILE_SECRET`·`OPENROUTER_API_KEY`는 wrangler secret 등록(이름만 확인 — `wrangler secret list`: GROQ_API_KEY·OPENROUTER_API_KEY·POLICY_KEY_SECRET·SESSION_SECRET·TURNSTILE_SECRET).
- "/me만 no-store이고 명세·한도 응답은 ETag 유지인지 시험으로" → `api.test.ts` 2건 추가(아래).
- "WAF가 *.workers.dev에 안 되면 Worker 안 분 단위 레이트 리밋. Rate Limiting 바인딩 무료 포함 여부를 먼저 공식 문서로" → 바인딩 문서·Workers 가격·한도 페이지 어디에도 Free 포함 여부가 없다(2026-11-06) → D1 `rl:` 범위(설계서 v0.1.29, DECISIONS 11-06).

- 폴백 체인 Groq → Workers AI `@cf/openai/gpt-oss-120b` → OpenRouter. Workers AI 상한은 설명 배치 90/일과 뉴런을 나눠 써 **11-08 배치 끝까지 0, 그 뒤 80** — 설계서 v0.1.27 §6.2·DECISIONS.
- `rulesUnavailable` 임시 처리(v0.1.22)를 정식 저하 모드로 — 구현 해석(설계서 v0.1.27): ① 예산 소진 429 `BUDGET` · ② 공급자 실패 503 · ③ 규정 검색 불가는 툴만 + `rulesUnavailable`·`dataStatus: DEGRADED`.

## 항목별

### 1 — 예산(`worker/src/llm/budget.ts`)

- 범위: `global`(질문 1건에 1) · `ip:<16 hex>`(질문 1건에 1 — IP + 일일 솔트(HMAC(SESSION_SECRET, "ip-salt:<날>"))의 SHA-256 앞 16자, 원문 IP 저장 없음, 날이 바뀌면 다른 키) · `provider:<이름>`(HTTP 호출마다 1).
- 상한 env `BUDGET_GLOBAL=150`·`BUDGET_USER=10`·`BUDGET_GROQ=55`·`BUDGET_WORKERS_AI=0`(배치 중)·`BUDGET_OPENROUTER=15`(wrangler.jsonc vars, 0~9999 정수만 — 틀리면 기본값). 전역 = `min(BUDGET_GLOBAL, 공급자 합)` → 배치 중 70. 키가 없는 공급자(OpenRouter 키 등록 전)는 상한 0(`withKeys` — 시도·카운터를 쓰지 않는다).
- **단위(설계서 v0.1.33, 운영자 2026-11-07)**: 전역·사용자 = **질문**(답 1건에 1), 공급자 = **호출**(LLM HTTP 1회에 1). 답 1건 = 호출 1~2회(툴이 필요하면 2)라 전역 질문 상한 = `min(BUDGET_GLOBAL, floor(공급자 호출 상한 합 ÷ 2))` — 설명 배치 중 floor((55+0+15)/2) = **35**, 11-08 뒤 floor(150/2) = **75**(v0.1.27의 `min(BUDGET_GLOBAL, 공급자 합)` = 70은 질문을 호출 1회로 쳤다). 2단계를 호출 1회로 합치는 것은 answer/v4(DECISIONS 11-07 — Phase 6 첫 프롬프트 PR, 안정 키 인용과 함께).
- 갱신은 기존 `reserveBudget`(INSERT OR IGNORE + `UPDATE … SET used = used + 1 WHERE … AND used < ?` 한 문장, 규약 5). 질문은 사용자 → 전역 순서(사용자에 막히면 전역 안 씀), 감소 경로 없음.
- Phase 4 개발 상한 `ASK_DAILY_CAP`(`ask:dev`) 제거.

### 2 — 폴백 체인(`worker/src/llm/providers.ts`)

- `fallbackChain([groq, workersAi, openrouter], reserve)`: 순서대로 공급자 예산 1을 차감하고 시도, 차감 거절(상한 0·소진)은 건너뛰고 시도 수에 세지 않는다. 429·5xx·0(타임아웃·네트워크·키 없음)이면 다음, 그 밖의 4xx는 그대로 던짐. 실제 시도 최대 2개. 답한 공급자의 체인 순번 = `fallbackDepth`(answer_log.fallback_depth, 응답 `fallbackDepth`), answer_log.provider = 답한 공급자.
- Workers AI: AI 바인딩 `@cf/openai/gpt-oss-120b`, 입력 `messages`·`response_format`(json_schema)·`max_tokens`·`temperature`(공식 모델 페이지 2026-11-06 확인 — 입력은 messages·response_format, **structured output의 응답 모양은 문서에 없음** → `choices[0].message.content`·`response`(문자열·객체) 둘 다 받는다. 실호출 확인은 11-08 뒤). 3036·4006·neurons 오류는 429로(다음 공급자로).
- OpenRouter: OpenAI 호환, 모델 `openrouter/free`(PHASES 원문), 키 `OPENROUTER_API_KEY`(사람 작업).

### 4 — 저하 모드

- `/ask`: 시도할 공급자가 하나도 없으면(읽기만 — `anyProviderLeft`) 질문 임베딩도 부르지 않고 429 `BUDGET` → 사용자·전역 차감 실패도 429 `BUDGET` → 체인이 `ProvidersExhausted`면 429 `BUDGET`, 시도한 공급자 모두 실패면 503 → 규정 검색 실패면 `rulesUnavailable`·`dataStatus: DEGRADED`.
- `/me` `budget {remainingToday, userRemaining, resetsAt}` — 요청마다 바뀌어 ETag·304 대신 no-store(`fresh()`), 전역 남은 0이면 `dataStatus: DEGRADED`. overlay `MeResponse.budget`.
- 화면: 상단 칩 "오늘 남은 질문 n회"(min(전역, 사용자), 0이면 경고)·"프롬프트 answer=vN"(Shell이 /me를 읽는다), 남은 0이면 화면 4 입력창·칩을 처음부터 비활성 + 남은 시간.

### 6 — `GET /api/v1/budget` + 화면 6

- 공개(세션 없음)·no-store. `{today, days[7], fallbackDepth{0,1,2}, refusals, cache{hit,miss}, degraded{rules}, caps}`. 분포는 answer_log를 설계사 경계 없이 모으지 않고(규약 3) `/ask`가 `budget_counter`의 `stat:*` 범위(`stat:depth:N`·`stat:refuse:<사유 소문자>`·`stat:cache:miss`·`stat:degraded:rules`)를 센다(설계서 v0.1.28). 사용자 키(`ip:…`)는 내보내지 않는다(시험).
- 화면 6 `/budget`: 오늘 사용/상한 막대(계열 하나씩 — 범주 색 없음, 숫자 병기)·7일 표·폴백 깊이·캐시·거부(영문 코드 없이)·저하. 설계사 선택 화면에서 링크.

### 3 — AI Gateway `copilot`·캐시(설계서 v0.1.29·v0.1.30 §6.4)

- Groq·OpenRouter: AI 바인딩 `gateway("copilot").run({provider, endpoint: "chat/completions", headers, query})`(유니버설 요청). 게이트웨이 `copilot`은 인증 게이트웨이라(잘못된 키로 경로 점검 → 게이트웨이 401 code 2009) URL fetch에는 게이트웨이 토큰이 필요하지만, 바인딩은 스스로 인증해 토큰·계정 ID를 코드·설정에 두지 않는다.
- Workers AI: `AI.run(model, input, {gateway: {id, cacheKey, cacheTtl}})`.
- 캐시 키: `ans:<hash16(정규화 질문·agentId·streamHash·promptVersion)>:1`(1단계)·`…:2:<hash16(툴 결과)>`(2단계), TTL 86,400초. `StructuredRequest.cacheKey`는 `requestBody` 밖이라 VCR 카세트 해시가 그대로다(시험).
- 게이트웨이 → 직접 1회: 바인딩이 던짐(타임아웃 제외)·게이트웨이 형식 오류 본문(`success:false`, `error` 배열)·404. 공급자 429·5xx는 그대로 통과해 폴백 체인이 받는다(시험). 응답 헤더 `cf-aig-cache-status`는 `StructuredResponse.gatewayCache`에 남긴다.
- **답 단위 재사용**("캐시 히트는 예산 미차감" — 게이트웨이 히트는 호출 뒤에야 보여 예산 선차감과 맞지 않는다): 예산 검사 전에 answer_log(이 설계사·활성 스트림·활성 프롬프트·정규화 질문, `created_at` 24시간 안, `cache_hit=0`, PASS 또는 범위 밖·다른 설계사·엔진 필요 거부, 규정 검색 없이 답한 행 제외)에서 최신 1행 → 새 행 `cache_hit=1`·응답 `cacheHit: true`, LLM·임베딩·예산 0, `stat:cache:hit`. 조회는 `ix_ans_created` 범위 검색(EXPLAIN 시험 — 마이그레이션 없음).

### 5 — Turnstile(설계서 v0.1.29·v0.1.31 §9·§10.1)

- `POST /api/v1/me/turnstile {token}` → Siteverify(form secret·response·remoteip, 5초) → `success`이고 `hostname`이 요청 호스트와 같으면 24시간 서명 쿠키 `copilot_human`(HttpOnly·Secure·SameSite=Lax). 서명 키 = SESSION_SECRET + 용도 + 요청 IP(커밋 보안 검토 지적 반영 — 다른 IP에서 같은 쿠키 재사용 불가, IP는 쿠키·로그에 없음).
- `/ask`는 `TURNSTILE_SECRET`이 있는 환경에서 쿠키가 없으면 403 `TURNSTILE_REQUIRED`(answer_log·예산·레이트 리밋 카운터 0 — 시험). 로컬·시험(비밀 없음)은 검사하지 않는다.
- `/me` `turnstile {required, verified, siteKey?}`(overlay). 화면 4: required이고 아직이면 위젯(명시적 렌더, `challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`), 끝나기 전 입력창 비활성. 403을 받으면 위젯을 다시 그린다.
- **IP 결합 트레이드오프(운영자 수용 2026-11-07, 설계서 v0.1.32)**: 모바일 데이터망은 IP가 자주 바뀌어 평가자가 24시간 안에 다시 확인할 수 있다. 그 경우를 덮는 동선 — 쿠키가 다른 IP에서 오면 `/me` `verified: false`(시험 "다른 IP 403")라 새로 연 화면은 처음부터 위젯, 이미 연 화면은 `/ask` 403 → 위젯을 다시 그리고 막 쓴 질문을 입력창에 되돌린다(`humanCheckNeeded` 시험 — 쿠키는 있었지만 403이면 다시 그림). "다시 확인" 버튼은 이 경우가 아니라 서버가 토큰을 거부한 경우(Siteverify 실패·hostname)의 재시도다. 남는 비용: 다시 확인 1회(자동 통과 모드면 클릭 없음).
- 로컬 캡처(Cloudflare 공개 시험 키 — 항상 통과 사이트 키·비밀): 위젯이 390px 화면 안에 그려진다. 시험 비밀의 Siteverify 응답은 `hostname: "example.com"`이라 localhost에서는 hostname 대조로 거부된다(의도된 동작) — 첫 캡처에서 거부 → 위젯 자동 초기화 → 자동 통과 → 거부가 끝없이 돌아(5초에 403 9회) 자동 초기화를 없애고 "다시 확인" 버튼으로 고쳤다(다시 찍은 캡처: 5초에 403 1회). `captures/phase-5-screen4-turnstile-local.png`

### 레이트 리밋(WAF 대체 — 설계서 v0.1.29 §7)

- `/ask` 맨 앞(사람 확인 다음): `budget_counter` 범위 `rl:ip:<16 hex>:<yyyymmddHHMM>`(사용자 키와 같은 일일 솔트 해시) 상한 3, 같은 `reserveBudget` 단일 UPDATE. 넘으면 429 problem `RATE_LIMITED` + `Retry-After`(다음 분 시작까지 1~60초), answer_log·예산 없음.
- Worker Cron `17 0 * * *` → `scheduled()`가 전날 이전 `rl:` 행 삭제(PK 범위 `'rl:' ≤ scope < 'rl;'`). 예산·통계 카운터는 남긴다(시험). D1 쓰기: `/ask` 1건에 INSERT OR IGNORE + UPDATE 2문장 추가.
- 화면 4: RATE_LIMITED면 그 질문 자리에 "n초 뒤 다시".

### ETag(운영자 보충 2026-11-06)

- `/me`만 no-store·ETag 없음, 나머지 `/me/*` GET 7개(명세 목록·월·라인·라인 상세·한도·한도 상세·차이)는 `private, no-cache` + `W/"<streamHash>.<demoNo>"` + If-None-Match 304 — `api.test.ts` "ETag 유지" 7건 + "예산을 써도 다른 응답의 ETag는 그대로" 1건.

## 배포(운영자 푸시 2026-11-07 11:46 UTC — deploy.yml)

```
deploy 79e0596 success — Uploaded ga-commission-copilot · Deployed ga-commission-copilot triggers · schedule: 17 0 * * *
```
- Cron 5개 한도(남은 이슈 8): 트리거 등록이 오류 없이 끝났다 — 계정 합계가 무료 5개 안이다(넘으면 배포가 실패한다).
- 공개 URL 점검(LLM 호출 없음, 2026-11-07): `/me` 200·`Cache-Control: no-store`·ETag 없음, `turnstile {required: true, verified: false, siteKey: 0x4AAAAAAF2LyuLvbqeCCVE5}`, `budget {remainingToday: 70, userRemaining: 10}` · 쿠키 없이 `POST /me/ask` → 403 `TURNSTILE_REQUIRED` · `/budget` caps `{global 70, groq 55, workers-ai 0, openrouter 15}`(OpenRouter 키 반영).
- **CI 실패 발견·수리**: `ci` 9428f49·79e0596 실패 — `api.test` `/me` dataStatus가 CI에서만 DEGRADED. 원인: CI에는 `.dev.vars`가 없어 공급자 키가 없고 `withKeys` 전역 상한이 0 → 남은 질문 0 → DEGRADED. 로컬은 `.dev.vars`의 진짜 Groq 키로 통과했다. 수리 afa13fb: vitest 설정에 가짜 공급자 키를 고정(로컬·CI 같은 조건, 시험이 진짜 키를 쓸 일도 없앰) — `.dev.vars`를 치운 상태로 426 통과 확인. 그동안 보고한 "CI 녹색"은 9428f49 이전 커밋 기준이었다.

## 공개 URL 브라우저 캡처(완료 기준 4 — 운영자 2026-11-07)

- `phase-5-public-browser-ask.png`(주소창 `…workers.dev/me/ask`): Turnstile 통과 뒤 위젯이 사라진 화면 4, "이 계약 해약하면 2월에 얼마 빠져요?" → 검증 통과·answer/v3·`get_policy_event_sim · simulation.clawbackAmount` 인용·툴 호출 1건·groq·openai/gpt-oss-120b·3,081ms. 같은 날 앞서 "8월 시책이 100만 원인데 왜 85만 5천 원만 들어왔나요?"도 검증 통과(groq·5,059ms — 주소창 없는 캡처라 증거 파일로는 쓰지 않음).
- `phase-5-public-budget.png`(주소창 `…workers.dev/budget`, 첫 질문 뒤): 전체 질문 1/70 · Groq 2/55(1·2단계) · Workers AI 0/0(배치 중 0 안내) · OpenRouter 0/15 · 폴백 깊이 1순위 1/1 · 캐시 적중 0%(0/1).
- 대조(공개 `/budget` API, 두 번째 질문 뒤): global 2 · groq 4 · depth `{0: 2}` · cache `{hit 0, miss 2}` · 거부 0 — 두 질문 모두 Groq 1순위, LLM 2회씩, 답 단위 재사용 없음(서로 다른 질문)과 맞다.
- 관찰: 상단 칩 "오늘 남은 질문"은 화면을 열 때 읽은 `/me` 값이라 답을 받은 뒤에도 줄지 않았다(첫 캡처 답 뒤 10회 — 실제 9, 두 번째 9회 — 실제 8). → **고침(운영자 결정 2026-11-07, 아래 "칩·예산 단위")**. 캡처 당시 전역 상한 70은 v0.1.33 전 공식이다(지금은 35).

## 칩·예산 단위(운영자 결정 2026-11-07 — 설계서 v0.1.33)

- `/ask` 응답 200·429 `BUDGET`·429 `RATE_LIMITED`(problem+json) 모두 `budget {remainingToday, userRemaining}` — 그 요청을 센 뒤 값(`questionsLeft` — `/me`와 같은 계산). overlay: `AskBudget`·`AskResponse`(200·429 BUDGET 본문, additionalProperties false) 추가, `Problem` 덧씌우기(`TURNSTILE_REQUIRED` 코드·선택 `budget` — 공통 거부 401·404·400은 그대로 code·message뿐).
- 화면 4: 응답의 `budget`을 상단 칩에 덮는다(`withAskBudget` — resetsAt은 `/me` 것, `/me` 다시 부르지 않음). 남은 질문이 0이 되면 그 자리에서 입력창 비활성.
- `/budget`: `today.calls {used, cap}`·`days[].calls`(공급자 호출 합) 추가. 화면 6 오늘 표 = 범위 | **질문**(답 1건에 1) | **호출**(LLM 1회에 1) — 공급자 행의 질문 칸은 "—", 7일 표 = 날 | 질문 | 호출(합·Groq·Workers AI·OpenRouter). 390px 가로 넘침 없음. `captures/phase-5-screen6-budget-split-local.png`(로컬 — `.dev.vars`에 Groq 키만 있어 질문 상한 floor(55/2) = 27, 호출 55).
- 배포 확인(운영자 푸시 f69a635 — ci·deploy 성공, LLM 호출 없음): 공개 `/budget` caps.global 35 · today 질문 2/35 · 호출 4/70 · 11-07 행 `{questions 2, calls 4, groq 4}` · `/me` budget `{remainingToday 33, userRemaining 8}`(같은 IP에서 질문 2건) · 쿠키 없는 `/ask` 403 그대로. CI는 dab97b5부터 다시 녹색(afa13fb 수리 확인).
- 공개 URL 칩 확인(운영자 브라우저 2026-11-07, `captures/phase-5-public-chip-after-answer.png`): "해약 환수율은 어떻게 정해지나요?" → 검증 통과·제25조 인용·groq·3,079ms, 답 뒤 상단 칩 "오늘 남은 질문 7회"(답 전 8 — 다시 읽지 않고 응답 값으로 줄었다). 공개 `/budget` 대조: 질문 2 → 3/35, 호출 4 → 5/70 — 규정만 인용하고 툴이 필요 없는 질문이라 호출 1회(답 1건 = 호출 1~2회의 실례), 깊이 0, 캐시 miss.
- 시험: worker `budget.test` 상한 공식(75·35·71 → 35·키 없는 공급자 27)·`questionsLeft`(질문 1건 → 1씩 감소, 공급자 호출은 질문 수를 바꾸지 않음)·`/budget` calls, `ask.test` "답 1건 뒤 1 준다"(가짜 Groq·가짜 AI 바인딩 — 외부 호출 없음, 200 budget = 직전 /me − 1 = 그 뒤 /me, 429 BUDGET 뒤 응답 = /me, AskResponse 스키마)·레이트 리밋 problem budget(Problem 스키마)·`cache.test` 재사용 budget 그대로 · web `ask.test` 칩 2(답 뒤 10 → 9회, 429 BUDGET → 0회 경고·RATE_LIMITED → 응답 값)·`budget.test` 질문·호출 열.

## 시험(LLM 호출 없음)

```
worker vitest → budget.test 10(상한·키 없는 공급자·사용자 키·차감 순서·상한 0 무쓰기·동시 50요청 → 정확히 30·/budget 2)
             · fallback.test 7(1순위 성공 depth 0 · Groq 429 → Workers AI depth 1 · Groq 5xx + Workers AI 0 → OpenRouter depth 2 · 최대 2회 · ProvidersExhausted · 400은 폴백 안 함 · 공급자 응답 모양)
             · ask.test 저하 ① 3 + 소진 뒤 설명·명세 200·/me DEGRADED 1 + 레이트 리밋 1
             · budget.test 레이트 리밋 4(분 키·3회·다음 분 · 동시 10 → 3 · Cron 삭제 · wrangler triggers)
             · api.test ETag 유지 7 + /me만 no-store 1
             · cache.test 13(게이트웨이 유니버설 요청·429 통과·자체 오류 3종 → 직접·게이트웨이 없음·카세트 해시 · Workers AI gateway 옵션 · 캐시 키 · 재사용 PASS·창·설계사·프롬프트 · 거부 재사용·FAIL·저하 ③ 제외 · EXPLAIN · /ask 소진 중 재사용 200 예산 0)
             · turnstile.test 9(Siteverify form · 비밀 없음 · 쿠키 없음 403 · 성공 → 쿠키 → 게이트 통과 · 실패 2 · 오류·형식·세션 · 다른 IP 403 · 위조·만료·세션 값)
web vitest   → ask.test 사람 확인 3(HumanCheck · api.ask 403·RATE_LIMITED·BUDGET 구분 · humanCheckNeeded 다시 받기)
pnpm -r test   → grounding 68 · web 59 · worker 428 · gen 207 통과(2026-11-07 v0.1.33 뒤, worker는 .dev.vars 없이도)
pnpm run lint  → 오류 0
```

## 사람 작업

- [x] `OPENROUTER_API_KEY` 등록(운영자 2026-11-06 — 이름 확인).
- [x] AI Gateway `copilot` 생성(운영자 2026-11-06) → wrangler.jsonc `AI_GATEWAY_ID`.
- [x] Turnstile 사이트 키·`TURNSTILE_SECRET` 등록(운영자 2026-11-06) → wrangler.jsonc `TURNSTILE_SITE_KEY`.
- [x] ~~WAF 레이트 리밋 규칙~~ → Worker 안 레이트 리밋으로 대체(운영자 결정 2026-11-06).
- [x] 푸시(운영자 2026-11-07) → deploy 성공·Cron 등록(위 배포 절).
- [x] 공개 URL 브라우저 캡처 1회(완료 기준 4 — 운영자 2026-11-07).
- [ ] 배포 뒤 확인(계속): 화면 4 위젯 실제 통과(사이트 키의 호스트 이름 목록에 workers.dev 호스트가 있어야 한다)·Cron 등록(`wrangler deploy` 출력의 schedule)·`/budget` 원격 값.
- [ ] 11-08 설명 배치 591/591 확인 → `BUDGET_WORKERS_AI` 80 커밋 → 푸시·배포 → 완료 기준 3 실호출 캡처(Workers AI 구조화 출력 모양 `choices`/`response` 기록, 게이트웨이 경유 Groq·OpenRouter 첫 실호출 경로 확인 포함).

## 남은 이슈

1. Workers AI 바인딩 structured output의 응답 모양이 공식 문서에 없다 — 두 모양을 받게 했고, 11-08 뒤 첫 폴백에서 확인한다.
2. ~~WAF가 `*.workers.dev`에 걸리는가~~ → Worker 안 레이트 리밋으로 닫음(설계서 v0.1.29). Rate Limiting 바인딩은 Free 포함 여부가 문서에 나오면 다시 본다(D1 쓰기 2문장/질문을 아낄 수 있다).
3. 질문은 사용자 → 전역 순서로 차감해 전역에서 막히면 이미 센 사용자 1은 돌려주지 않는다(규약 5 — 감소 경로 없음).
4. ~~배포 뒤 `capture-public.yml`은 `/ask`에서 403~~ → **닫음(운영자 2026-11-07)**: 우회 경로 없이 `capture-local.yml`로 바꿈(CI 안 `wrangler dev --env record` — D1 로컬·Vectorize·AI 원격, Turnstile 없음 — 이름대로 공개 URL 캡처가 아니다). 사람 확인을 요구하는 서버면 스크립트가 묻지 않고 멈춘다(로컬 시험 키 서버로 확인 — 질문 0건, exit 1). 12건이 한 IP라 그 서버에만 `--var BUDGET_USER:20` — 같은 문제가 `record-answer`에도 있어(Phase 5 사용자 상한 10 → 11·12번 BUDGET) 함께 고쳤다. 공개 URL 동작은 완료 기준 4(사람 브라우저 캡처).
5. 유니버설 요청의 OpenRouter 경로 표기가 문서마다 다르다(`chat/completions` vs `v1/chat/completions`). `chat/completions`로 두고, 틀려 게이트웨이가 404를 내면 직접 URL로 1회 넘어가게 했다 — 첫 실호출에서 `cf-aig-cache-status` 헤더 유무로 경유 여부를 확인한다.
6. 게이트웨이 캐시 히트도 공급자 예산은 이미 1 차감된 뒤다(예산을 먼저 잡는 순서). "캐시 히트는 예산 미차감"은 답 단위 재사용이 지킨다. 게이트웨이 히트는 같은 키로 2단계가 이어지는 경우 등 보조.
7. 같은 질문이 근거 실패(FAIL)였으면 재사용하지 않지만, 게이트웨이 캐시가 같은 LLM 응답을 24시간 돌려줘 다시 물어도 같은 FAIL이 나올 수 있다(temperature 0이라 캐시 없이도 비슷하다). 운영자 제안(2026-11-07 — "NOT_GROUNDED 거부 응답에 `cf-aig-skip-cache`, 1줄이면 지금")은 **1줄로 되지 않아 하지 않았다**: `cf-aig-skip-cache`는 요청 헤더라 보내기 전에 정해야 하는데, NOT_GROUNDED는 응답이 돌아와 검증기(G1~G6)를 거친 뒤에야 정해진다 — 그때는 게이트웨이가 이미 그 응답을 캐시했다(응답 쪽에서 캐시를 막는 수단은 없다). 가장 작은 올바른 안: 묻기 전에 answer_log에서 같은 키의 24시간 안 FAIL 행이 있으면 그 질문의 두 단계 요청에 `cf-aig-skip-cache`(ScopedQuery 조회 1개 + 요청 플래그 + 두 공급자 헤더 — 약 15줄·시험). Phase 6 평가 뒤 또는 운영자 승인 시.
8. ~~Cron Triggers 계정당 5개~~ → 배포에서 오류 없이 등록(`schedule: 17 0 * * *`) — 닫음.
