# Phase 5 — 예산·폴백·캐시·봇 방지 증거(진행 중)

- 수행일: 2026-11-06(UTC) — 시작(운영자 지시: Phase 4 수용 뒤 PHASES Phase 5 항목 1~7, 폴백 체인 Groq → Workers AI gpt-oss-120b → OpenRouter)
- 기준 문서: 설계서 v0.1.28 §6.2·§6.4·§7 저하 모드·레이트 리밋·§9 남용 방지·§10.2·§10.4, PHASES.md Phase 5
- 도구 버전: node 25.5.0(CI 24), pnpm 10.28.2, wrangler 4.153.0, vitest 4.1.12
- 상태: **항목 1·2·4·6 구현(LLM 호출 없음 — 시험은 가짜 공급자·로컬 D1)**. 항목 3(AI Gateway)·5(Turnstile)는 사람 작업(게이트웨이·사이트 키) 뒤. 완료 기준의 실호출(Groq 429 유도 → Workers AI 폴백 캡처)은 폴백 상한이 열리는 11-08 설명 배치 끝 뒤.

## 완료 기준 대조

| # | 완료 기준(PHASES.md 원문) | 결과 | 증거 |
|---|---|---|---|
| 1 | 테스트 통과 | 진행 — 지금까지 항목 시험 통과(아래) | `worker/test/budget.test.ts`·`fallback.test.ts`·`ask.test.ts`, `web/test/budget.test.tsx`·`App.test.tsx` |
| 2 | /budget에 공급자별 사용·폴백 분포 표시 | 구현(로컬 캡처, 값 0) — 원격은 푸시·배포 뒤 | `captures/phase-5-screen6-budget-local.png` |
| 3 | 실호출로 Groq 429 1회 유도 후 Workers AI 폴백 기록 캡처 | **대기** — `BUDGET_WORKERS_AI=0`(설명 배치와 뉴런 나눔, 설계서 v0.1.27) → 11-08 배치 591/591 뒤 80으로 바꾸는 커밋 다음 | — |

## 운영자 결정(2026-11-06)

- 폴백 체인 Groq → Workers AI `@cf/openai/gpt-oss-120b` → OpenRouter. Workers AI 상한은 설명 배치 90/일과 뉴런을 나눠 써 **11-08 배치 끝까지 0, 그 뒤 80** — 설계서 v0.1.27 §6.2·DECISIONS.
- `rulesUnavailable` 임시 처리(v0.1.22)를 정식 저하 모드로 — 구현 해석(설계서 v0.1.27): ① 예산 소진 429 `BUDGET` · ② 공급자 실패 503 · ③ 규정 검색 불가는 툴만 + `rulesUnavailable`·`dataStatus: DEGRADED`.

## 항목별

### 1 — 예산(`worker/src/llm/budget.ts`)

- 범위: `global`(질문 1건에 1) · `ip:<16 hex>`(질문 1건에 1 — IP + 일일 솔트(HMAC(SESSION_SECRET, "ip-salt:<날>"))의 SHA-256 앞 16자, 원문 IP 저장 없음, 날이 바뀌면 다른 키) · `provider:<이름>`(HTTP 호출마다 1).
- 상한 env `BUDGET_GLOBAL=150`·`BUDGET_USER=10`·`BUDGET_GROQ=55`·`BUDGET_WORKERS_AI=0`(배치 중)·`BUDGET_OPENROUTER=15`(wrangler.jsonc vars, 0~9999 정수만 — 틀리면 기본값). 전역 = `min(BUDGET_GLOBAL, 공급자 합)` → 배치 중 70. 키가 없는 공급자(OpenRouter 키 등록 전)는 상한 0(`withKeys` — 시도·카운터를 쓰지 않는다).
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

## 시험(LLM 호출 없음)

```
worker vitest → budget.test 10(상한·키 없는 공급자·사용자 키·차감 순서·상한 0 무쓰기·동시 50요청 → 정확히 30·/budget 2)
             · fallback.test 7(1순위 성공 depth 0 · Groq 429 → Workers AI depth 1 · Groq 5xx + Workers AI 0 → OpenRouter depth 2 · 최대 2회 · ProvidersExhausted · 400은 폴백 안 함 · 공급자 응답 모양)
             · ask.test 저하 ① 3 + 소진 뒤 설명·명세 200·/me DEGRADED 1
pnpm -r test   → grounding 68 · web 53 · worker 381 · gen 207 통과(2026-11-06)
pnpm run lint  → 오류 0
```

## 사람 작업

- [ ] `OPENROUTER_API_KEY` — `wrangler secret put OPENROUTER_API_KEY`(값은 입력창으로, 출력·기록하지 않는다). 없으면 OpenRouter 상한은 0으로 동작한다.
- [ ] AI Gateway 생성(대시보드 AI → AI Gateway, 무료) — 이름을 알려 주면 항목 3에서 `AI_GATEWAY_ID` var로 넣는다(URL은 바인딩 `gateway(id).getUrl()` — 계정 ID를 코드에 두지 않는다).
- [ ] Turnstile 사이트 생성(무료, 도메인 `ga-commission-copilot.ga-copilot-demo.workers.dev`) — 사이트 키(공개 var)와 `TURNSTILE_SECRET`(`wrangler secret put`).
- [ ] WAF 레이트 리밋 규칙 `/api/v1/me/ask` IP당 분당 3회(설계서 §7 — 대시보드). workers.dev 하위 도메인에 WAF 규칙을 걸 수 있는지 확인 필요(남은 이슈 2).
- [ ] 11-08 설명 배치 591/591 확인 → `BUDGET_WORKERS_AI` 80 커밋 → 푸시·배포 → 완료 기준 3 실호출 캡처.

## 남은 이슈

1. Workers AI 바인딩 structured output의 응답 모양이 공식 문서에 없다 — 두 모양을 받게 했고, 11-08 뒤 첫 폴백에서 확인한다.
2. 설계서 §7의 "IP당 분당 3회(Cloudflare WAF 무료 규칙)"는 zone 기능이라 `*.workers.dev`에 걸리지 않을 수 있다 — 확인 전. 안 되면 Worker 안 레이트 리밋(Workers Rate Limiting 바인딩 무료 여부 확인 후 §10에 먼저 적는다) 또는 사용자 예산으로 대신 — 운영자 판단.
3. 질문은 사용자 → 전역 순서로 차감해 전역에서 막히면 이미 센 사용자 1은 돌려주지 않는다(규약 5 — 감소 경로 없음).
