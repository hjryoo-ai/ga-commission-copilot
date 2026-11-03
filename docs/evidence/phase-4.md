# Phase 4 — 사규집·RAG·툴·자유 질문 증거(진행 중)

- 수행일: 2026-11-01(UTC) — 항목 1·2·3 착수(운영자 지시: 설명 배치와 병행, PHASES Phase 4 항목 1·2·3부터)
- 기준 문서: 설계서 v0.1.18 §4.1(c)·§4.2·§4.3·§4.4·§5.1·§5.2·§6.3·§6.5·§10, 부록 A·B.1·B.2, PHASES.md Phase 4
- 도구 버전: node 25.5.0, pnpm 10.28.2, wrangler 4.153.0, vitest 4.1.12, `gpt-tokenizer` 4.0.0(gen devDependency — 2026-08-16 배포판으로 고정, o200k 토큰 수), LLM: Groq `openai/gpt-oss-120b`(사규집 녹화), 임베딩 `@cf/baai/bge-m3`
- 상태: **항목 1 완료 — 사규집 생성·청킹·D1 적재, 임베딩·Vectorize 업서트(2026-11-02 11:10 UTC, 벡터 40·visibility 인덱스).** 항목 2·3 수용(2026-11-01, 편차 6건 수용). 항목 4 — `/me/ask`·`/answers/{id}`·개발 상한·LLM_TRACE 녹화 경로·`sim_stub` 적재 완료(LLM 없는 경로 시험). 부록 A 12건 녹화(카세트)·항목 5·6과 완료 기준은 아직.

운영자 조건(2026-11-01): 사규집 40조항 생성과 답변 프롬프트 녹화는 Groq, 임베딩만 Workers AI. `/me/ask`는 활성 설명 배치와 D1 쓰기 예산을 공유하므로 answer_log 적재 시험은 로컬 D1에서만. 푸시는 운영자.

## 항목 1 — 가상 사규집(`gen/rulebook/`)

| 단계 | 결과 | 증거 |
|---|---|---|
| 조항 계획 | `gen/rulebook/articles.ts` — 40조항(7장), 번호·제목·공개 범위·다룰 내용(숫자 없음)·사실값(facts)을 코드가 정한다. facts는 엔진 대역 `world/rules/tables.ts`에서(한도 배수 12·1200%, 적용일 2026-07-01·2027-01-01, 분급 40%·12/24/36개월·20%, 환수율 1~6회차 70%·7~12회차 40%·13회차부터 없음, 원천세 0.033, 마감 5일·지급 10일, 경고 단계 80·95·100%), 엔진에 없는 절차 수치만 `RULEBOOK_ONLY`(이의제기 30일·처리 14일·보존 5년 — 가상 예시값). internal = 제9조 상품별 요율표·제10조 등급별 지급률표·제11조 시책표 | `gen/test/rulebook.test.ts` |
| 프롬프트 | `prompts/rulebook/v1.md`(조항 1건 = 호출 1회, `{body, numbersUsed}`), `prompts/rulebook_repair/v1.md`, CHANGELOG. 조항 머리 "제N조(제목) — 가상 규정 · 예시값"은 코드가 붙인다 | |
| 게이트 | G1(`contracts/rulebook/v1/article-llm.schema.json`) → G4(본문·numbersUsed ⊆ 그 조항 facts — 규약 1) · G6(금지어 + 지시문 형태 텍스트 §6.5) → 재생성 1회 → 재실패면 사규집을 쓰지 않는다 | `gen/rulebook/gate.ts` |
| 시험 녹화 | 조항 9·12·36 두 번: 1회차 — 제9조 줄바꿈을 `\n` 글자로 내 목록 머리 "2"가 G4에 걸림, 제12·36조는 다룰 내용 밖 절차를 지어냄("계약서에 명시", "별도 협의", "지정된 양식"). → 프롬프트에 "여기 없는 절차·조건·서류·양식·부서·협의·예외를 지어내지 않는다"·외래어 금지, 게이트에 이스케이프 줄바꿈 정규화(서식만). 2회차 3/3 PASS | `logs/phase-4-rulebook-record*.log` |
| 녹화 | 1차 실행이 제19조 뒤 예산 차감(원격 D1)에서 Cloudflare **7403**(일시 오류 — Phase 1에도 1회)으로 멈춤 → 카세트에서 이어서. **40/40 PASS, 첫 시도 38/40**(제9·11조 재생성). 제40조는 "한도·분급 조항은 2026년 7월 1일부터"로 적용일을 뒤섞어(뜻 오류 — 숫자는 facts 안이라 G4 통과) 다룰 내용을 한도·분급으로 나눠 1회 재녹화 | `logs/phase-4-rulebook-record-attempt1-7403.log`, `logs/phase-4-rulebook-record.log`, 카세트 `gen/providers/vcr/rulebook.json`(42항목, 입력 45,506 + 출력 8,958 토큰) |
| 산출 | 사규집 `0453f7d205db…`: `data/rulebook/0453f7d205db41df5f162596f31cca0b6f9783ec51d0ace7f41d01033deb6428/{articles,chunks}.jsonl` — 조항 40, **청크 40**(agent 37 · internal 3), o200k 토큰 합 3,507 · 최소 41 · 최대 257 | |
| D1 적재 | `load:d1 -- --local\|--remote --rulebook`(INSERT OR IGNORE): 로컬 40행, **원격 40행 — rows written 80** | `logs/phase-4-rulebook-load.log` |
| 임베딩·업서트 | `rulebook:embed -- --upsert`(bge-m3 REST, `visibility` 메타데이터 인덱스를 먼저 만들고 `wrangler vectorize upsert rulebook-v1`). 2026-11-01 01:2x UTC 1회 시도 → **429 code 4006 "daily free allocation of 10,000 neurons"** — 설명 배치 85회 뒤 당일 뉴런 소진. 00:01 UTC 예약은 실행되지 않았다(세션이 깨어 있지 않음). **2026-11-02 11:10 UTC — 설명 배치 직전에 실행**: 임베딩 40개 · bge-m3 호출 1회(dev 예산, 4006 없음) · 토큰 합 3,507 → `gen/out/rulebook/0453f7d2…/vectors.ndjson` → `--upsert`(저장된 임베딩 재사용 — 추가 Workers AI 호출 없음): metadata index `visibility` 만듦 → 40개 업서트(mutation `ae1c0bc3…`). 확인: `vectorize info` **vectorCount 40**·1024차원·processedUpTo 2026-11-02T11:10:32Z, `list-metadata-index` **visibility String**. 필터 점검: 제9조(internal) 자기 벡터로 질의 — 필터 없으면 1·2위가 internal(제9·11조), `{"visibility":"agent"}`면 5건 모두 agent | `logs/phase-4-rulebook-embed-2026-11-02.log`(1차 시도 `logs/phase-4-rulebook-embed.log`), `logs/phase-4-vectorize-filter-2026-11-02.log` |

## 항목 2 — 툴(`worker/src/tools/`)

- `get_statement(ym)`: 월 행(상태·총액·원천세·실지급·지급일·상계·이월) + 유형별 합계(DerivedNumbers.byType) + 라인 요약(한도 삭감 라인은 요청액 DerivedNumbers.requested).
- `get_limit(policyNo)`: 뒷자리 매칭("***0001"·"0001"·"0001 계약" — 이 설계사 증권번호 집합에서만), 원장(잔여·소진율·단계 DerivedNumbers) + 이력(전기 뒤 소진율) + 한도 삭감 라인 + 연결 분급(이연). 끝 4자리가 같은 계약이 여럿이면 후보만.
- `get_deferrals(from, to)`: 예정월 기간(36개월 이내) 항목 + 월별·상태별 합계(`DerivedNumbers.sumBy` — 새 메서드, 합계만).
- `get_policy_event_sim(policyNo)`: `sim_stub` 조회(`ScopedQuery.simStub` — tenant_id·agent_id·증권번호), 없으면 `NO_STUB`(→ NEEDS_ENGINE). 스텁 JSON 안의 증권번호 원문은 마스킹.
- 공통: 인자 검사(`parseToolCall` — 알 수 없는 툴·덧붙인 인자(agentId 등)·형식 오류·기간 초과 거부), 결과 ≤ 1,200토큰(넘으면 목록 30건, 그래도 넘으면 반씩 — `…Shown`·`…Total` 표시). 토큰은 Worker에 토크나이저를 싣지 않고 보수적 추정(ASCII 2.5자·그 밖 1자당 1토큰).
- 시험: `worker/test/tools.test.ts` 11건(세션 설계사 범위, 남의 증권번호 미검색, 마스킹, 인자 거부, 크기 컷).

## 항목 3 — 공급자·프롬프트 레지스트리·답변 파이프라인(`worker/src/llm/`)

- `providers.ts`: Groq만, OpenAI 호환 fetch 1회, 8초 타임아웃, 본문은 gen과 같은 모양(temperature 0·reasoning_effort low·json_schema strict). 429는 `retry-after`와 함께 `ProviderError`(폴백은 Phase 5). 키는 `GROQ_API_KEY`(wrangler secret — 아직 원격에 넣지 않았다).
- `promptRegistry.ts`: `prompts/<name>/v<N>.md`를 텍스트 모듈로 묶어(wrangler `rules` Text · vitest 같은 변환) frontmatter 파싱, `PROMPT_VERSIONS`의 `answer=vN`(없으면 v1). `wrangler deploy --dry-run`으로 .md가 별도 Text 모듈로 묶이는 것 확인(레지스트리 진입점 시험 번들 — 라우트 연결은 항목 4).
- `answer.ts`(§4.3): 질의 정규화 → bge-m3 임베딩 → Vectorize topK 6 · filter visibility=agent → D1 `rulebook_chunk`에서 visibility=agent만 한 번 더 → LLM 1단계(툴 계획 또는 바로 답/거부) → 툴(최대 3, 세션 설계사) → LLM 2단계 → G1(모양)·G4(툴 결과 + 검색 청크 본문의 숫자 — `withTextTokens`, 새 함수)·G5(툴 인용은 부른 툴의 키, 규정 인용은 검색된 청크)·G6 → 실패면 `NOT_GROUNDED` 고정 문구, 거부는 §4.4 고정 문구 → `answer_log`(거부 포함, `ScopedQuery.insertAnswerLog` — 툴이 아니라 파이프라인만 쓴다).
- 프롬프트 `prompts/answer/v1.md`(부록 B.1 규칙 1~6 + 단계·툴 설명·거부 조건·인용 규칙), 스키마 `contracts/answer/v1/answer.schema.json`.
- 시험: `worker/test/answer.test.ts` 9건(가짜 공급자·임베딩·검색, 로컬 D1) — A-01형 PASS와 answer_log 열(retrieved_chunks·tool_calls·grounding_status), internal 청크 미투입, A-12형 오답 유도 → NOT_GROUNDED, 규정 숫자는 검색 청크에 있으면 통과·검색 안 된 청크 인용은 G5, OTHER_AGENT·NEEDS_ENGINE 고정 문구, 남의 증권번호 툴 인자, 출력 모양 오류, Groq 본문·429.

## 운영자 결정(2026-11-01, 항목 1~3 수용 때)

- Workers AI 배치 상한 **70/일**, 뉴런 소진 3036·4006 둘 다 그날 끝, 개발용 Workers AI 호출(임베딩)은 배치보다 먼저 — `DECISIONS.md`, 설계서 v0.1.17, 커밋 `e6b9d30`.
- §14.1-5 확정: 조항 단위 1청크, 상한 600(실측 41~257), 벡터 40(검색 대상 37) — 설계서 v0.1.17 `a0c40b2`.
- 원격 `GROQ_API_KEY`: `grep '^GROQ_API_KEY=' gen/.dev.vars | cut -d= -f2- | (cd worker && pnpm wrangler secret put GROQ_API_KEY)` — "Success! Uploaded secret GROQ_API_KEY", `wrangler secret list` 이름 3개(GROQ_API_KEY·POLICY_KEY_SECRET·SESSION_SECRET). 값은 출력·기록하지 않았다.
- 답변 VCR 방식·`sim_stub` 경로·Vectorize 로컬 시험은 아래 항목 4·남은 이슈.

## 운영자 결정(2026-11-02, 2일차 수용 때)

- Workers AI 배치 상한 **90/일**(대시보드 실측 70회 = 6,870뉴런, 회당 98 — `usage` 일치. 90 × 98 ≈ 8,820, 개발용 약 1,100 남음). DECISIONS의 "원인 미상" → "대시보드 실측 98/회로 usage 일치, 전일 초과는 관문 녹화 포함 추정". 설계서 v0.1.19.
- **Vectorize 시험 방식 (b) 승인** — 아래 "Vectorize 필터 점검"이 항목 6 완료 기준("internal 청크가 어떤 질의에도 반환되지 않음")의 증거. 단위 시험은 D1 재필터(`answer.test.ts`).
- **원격 0005 적용 승인** → 적용(아래).
- 부록 A 12건 답변 녹화는 2026-11-03 00:00 UTC 리셋 뒤 배치 앞에서(임베딩 12회 ≈ 0.6뉴런 — 순서는 사실 무관하지만 규칙 유지).

## Vectorize 필터 점검(항목 6 완료 기준 증거 — 방식 (b))

`cd gen && pnpm run rulebook:vectorize-check`(`gen/rulebook/vectorize-check.ts`): internal 청크 3개마다 자기 벡터로(`--vector-id`) ① 필터 없음 top-k 5(대조군 — 1위가 자기 자신이어야 internal 벡터가 인덱스에 있고 검색된다는 뜻), ② `{"visibility":"agent"}` top-k 20(런타임 `answer.ts`와 같은 필터 — internal 0건·20건 모두 agent). internal에 가장 가까운 질의라 필터가 새면 여기서 먼저 보인다. Workers AI 호출 없음, 질의 6회(약 25만 질의 차원 — 무료 월 3,000만). 판정 함수 `judge`·출력 파서는 `gen/test/rulebook.test.ts` 3건.

```
$ cd gen && pnpm run rulebook:vectorize-check
rulebook 0453f7d205db — 청크 40(agent 37 · internal 3), 인덱스 rulebook-v1, 2026-11-02T11:33:06.269Z
== rb-0453f7d205db-a09-1(internal) 자기 벡터로 질의
  ① 필터 없음 top-k 5: ✓ 1위 = 자기 자신(internal) — internal 2건
     rb-0453f7d205db-a09-1(1.0000, internal) · rb-0453f7d205db-a11-1(0.7051, internal) · rb-0453f7d205db-a05-1(0.6972, agent) · rb-0453f7d205db-a06-1(0.6899, agent) · rb-0453f7d205db-a07-1(0.6839, agent)
  ② visibility=agent top-k 20: ✓ internal 0건
     rb-0453f7d205db-a05-1(0.6972, agent) · rb-0453f7d205db-a06-1(0.6899, agent) · rb-0453f7d205db-a07-1(0.6839, agent) · rb-0453f7d205db-a02-1(0.6635, agent) · rb-0453f7d205db-a12-1(0.6405, agent) … (+15)
== rb-0453f7d205db-a10-1(internal) 자기 벡터로 질의
  ① 필터 없음 top-k 5: ✓ 1위 = 자기 자신(internal) — internal 2건
     rb-0453f7d205db-a10-1(1.0000, internal) · rb-0453f7d205db-a20-1(0.6515, agent) · rb-0453f7d205db-a21-1(0.6379, agent) · rb-0453f7d205db-a14-1(0.6371, agent) · rb-0453f7d205db-a09-1(0.6261, internal)
  ② visibility=agent top-k 20: ✓ internal 0건
     rb-0453f7d205db-a20-1(0.6515, agent) · rb-0453f7d205db-a21-1(0.6379, agent) · rb-0453f7d205db-a14-1(0.6371, agent) · rb-0453f7d205db-a31-1(0.6158, agent) · rb-0453f7d205db-a19-1(0.6151, agent) … (+15)
== rb-0453f7d205db-a11-1(internal) 자기 벡터로 질의
  ① 필터 없음 top-k 5: ✓ 1위 = 자기 자신(internal) — internal 2건
     rb-0453f7d205db-a11-1(1.0000, internal) · rb-0453f7d205db-a09-1(0.7050, internal) · rb-0453f7d205db-a08-1(0.6982, agent) · rb-0453f7d205db-a40-1(0.6548, agent) · rb-0453f7d205db-a03-1(0.6200, agent)
  ② visibility=agent top-k 20: ✓ internal 0건
     rb-0453f7d205db-a08-1(0.6982, agent) · rb-0453f7d205db-a40-1(0.6548, agent) · rb-0453f7d205db-a03-1(0.6200, agent) · rb-0453f7d205db-a29-1(0.6183, agent) · rb-0453f7d205db-a32-1(0.6083, agent) … (+15)
판정: 통과 — internal 3개 모두 필터 없이 1위, visibility=agent 필터로 0건
```
전체 로그: `logs/phase-4-vectorize-check-2026-11-02.log`(같은 날 손으로 한 첫 점검: `logs/phase-4-vectorize-filter-2026-11-02.log`).

## 답변 녹화 준비(운영자 2026-11-02 — 녹화는 11-03 00:00 UTC 리셋 뒤 배치 앞)

**재생 픽스처**(남은 이슈 3 해소): `gen/scripts/answer-fixture.ts`(`cd gen && pnpm run fixture:answer`)가 활성 스트림(`pickStream` — data/stream의 `fca1971c…`)의 `meta.demoAgents` 3명 행을 projection-java 리플레이 뷰에서 뽑아(`demoViews` — agent_id, `policy_limit_history`는 그 설계사들의 원장) 적재기와 같은 SQL(`insertPlan` 슬롯 a + `rulebookInserts` 40청크 + `simStubInserts` 1행 + stream_meta 활성화)로 `worker/test/fixtures/demo-stream.json`(243KB, 문장 15)에 쓴다. 손 복사 없음. 행: agent_profile 3 · earnings_line 482 · earnings_month 91 · policy_limit 21 · history 25 · deferral 24 · clawback 3 · flag 19.
- 신선도: `gen/test/answer-fixture.test.ts` — 커밋된 픽스처가 지금 data로 만든 것과 바이트 단위로 같아야 한다(스트림 해시가 바뀌면 실패 → 스크립트 다시). 결정론(verified_at = 스트림 generatedAt).
- worker: `test/demo-stream.ts`의 `seedDemoStream()`(시험 D1을 비우고 문장 실행), `test/demo-stream.test.ts` 2건 — `/health` streamHash = 픽스처·라인 482, A-1001 `get_limit("0001")` = 원장 1·한도 1,800,000, 사규집 40·sim_stub 1행. 툴은 시크릿을 쓰지 않으므로 녹화(로컬 `.dev.vars.record`)와 시험의 툴 결과가 같다.

**녹화 설정 `env.record`**(`worker/wrangler.jsonc`): 평소 설정과 같은 D1·vars + **Vectorize만 `remote: true`**(AI는 원래 늘 원격 — 질문 임베딩 bge-m3, `remote: true`는 경고를 없애려고 적었을 뿐). 평소 `wrangler dev`·vitest(`remoteBindings: false`, 최상위 설정)·배포는 env를 고르지 않으므로 섞이지 않는다. `test/arch.test.ts` 2건 — env는 record 하나, 최상위에 remote 없음, record의 D1·vars = 최상위, Vectorize·AI만 remote.
- **편차(확인)**: 지시의 "`wrangler dev --local` + Vectorize remote"는 wrangler 4.153에서 안 된다 — `--local`이면 원격 바인딩이 모두 꺼진다(바인딩 표: `env.VECTORIZE … not supported`, `env.AI … not supported`). 그래서 녹화 명령은 **`cd worker && pnpm exec wrangler dev --env record`**(`--local` 없이): 바인딩 표 `env.DB (copilot) D1 local` · `env.VECTORIZE (rulebook-v1) remote` · `env.AI remote`, `/health` streamHash `fca1971c…`·earningsLines 5200(로컬 D1 그대로). D1은 remote 표시가 없어 로컬이다.
- CI 배포(`.github/workflows/deploy.yml`)는 `wrangler deploy --env=""`로 최상위 환경을 명시 — env가 둘 이상이면 wrangler가 "no target environment" 경고를 낸다. `--dry-run`으로 경고 없음·바인딩 DB·VECTORIZE·AI·PROMPT_VERSIONS 확인.
- 시크릿: `worker/.dev.vars.record`(이 env에서만 읽힌다 — 커밋 안 함, `.gitignore`에 `.dev.vars.*`·`!.dev.vars.example` 추가)에 `worker/.dev.vars`의 GROQ_API_KEY·SESSION_SECRET·POLICY_KEY_SECRET를 grep으로 옮기고 `LLM_TRACE=1`을 더했다(값은 출력하지 않았다 — 키 이름·"값 있음"만 확인). `.dev.vars.example`에 안내 줄.

## 부록 A 12건 답변 녹화(2026-11-03 11:10~11:17 UTC — 운영자 순서: 녹화 → 재생성 → 재검증 → 배치)

- 환경: 로컬 D1에 0005 적용(로컬에는 아직 없었다) → `llm_trace`·`answer_log`·`budget_counter(ask:dev)` 비움 → `cd worker && pnpm exec wrangler dev --env record --port 8799` — "Using secrets defined in .dev.vars.record", 바인딩 `DB local` · `VECTORIZE remote` · `AI remote` · `LLM_TRACE (hidden)`. 로컬 활성 스트림 `fca1971c…`(slot b), 사규집 40·sim_stub 1.
- 질문: 데모 1(A-1001) 세션(`POST /api/v1/demo/session {demoAgent: 1}`)으로 부록 A 원문 12개를 `POST /api/v1/me/ask`, 30초 간격(Groq TPM). 모두 HTTP 200, 429·503 없음. 공급자 Groq `openai/gpt-oss-120b`, 프롬프트 `answer/v1`. 응답 원문 `logs/phase-4-answer-record-2026-11-03.{log,json}`.
- **`llm_trace` 19행**(요청 해시 19개 모두 다름 — 1단계 12 + 2단계 7, 11:11:06~11:17:25Z) → `node gen/scripts/answer-cassette.ts` → **카세트 `worker/test/vcr/answer.json`(19항목, 199,694바이트, 키·인증 헤더 없음 — 요청 본문만)**.
- 재생 시험 `worker/test/answer-vcr.test.ts` 13건 통과: `seedDemoStream()`(재생 픽스처) + `vcrProvider` + 녹화 1단계 요청의 `[chunkId]` 순서대로 가짜 검색 → **요청 해시 19개 모두 일치, 툴 결과 해시(resultHash)도 녹화와 같다**(픽스처 = 녹화 D1). internal 청크(제9~11조)는 12개 질문의 검색 어디에도 없다(실제 질의로 본 필터).

| # | 질문 | 툴 호출(인자 → 결과 해시) | 판정(녹화 응답 / 재생) | G4~G6·G1 위반 | 부록 A 기대 |
|---|---|---|---|---|---|
| A-01 | 8월 시책이 100만 원인데 왜 85만 5천 원만 … | get_statement(**202308**) → 없음 `0b2d5f…` | 거부 NEEDS_ENGINE · NONE | — | get_statement(202608), 1,000,000·855,000·145,000 ✗ |
| A-02 | 한도로 빠진 14만 5천 원은 언제 받나요? | get_statement(**202311**) → 없음 `94c836…`, 2단계가 get_deferrals를 더 요청(1회만 돈다) | 녹화 응답 **PASS·빈 본문** → 고친 뒤 재생 **NOT_GROUNDED · FAIL** | G1 text 비어 있음(아래 수정) | get_limit, "데이터로는 확인되지 않음" ✗ |
| A-03 | 0001 계약 한도는 언제 다 찼나요? | get_limit(0001) → 원장 1 `10b4df…` | **PASS** | — | 둘째 전기 후 1,800,000·100% — 답은 "현재 누적 1,080,000·60%, 다 찬 시점 확인 불가"(전기 이력 대신 현재 원장만 읽음) △ |
| A-04 | 한도 산식이 뭔가요? | 없음 | 거부 OUT_OF_SCOPE · NONE | — | get_limit + 규정(150,000 × 12) ✗ |
| A-05 | 8월 실수령은 얼마예요? | get_statement(**202308**) → 없음 `0b2d5f…` | 거부 NEEDS_ENGINE · NONE | — | 1,740,600 ✗ |
| A-06 | 2026년 8월하고 2027년 2월은 뭐가 달라졌어요? | 없음(1단계에서 규정만으로 답) | NOT_GROUNDED · FAIL | G4 "2026년 8월"·"2027년 2월"(질문 속 날짜가 S에 없다) | get_statement × 2 ✗ |
| A-07 | 이 계약 해약하면 2월에 얼마 빠져요? | get_deferrals(from·to null) → **툴 인자 거부** | 거부 OUT_OF_SCOPE · NONE | (툴 호출 거부) | get_policy_event_sim −720,000 ✗ |
| A-08 | 해약 환수율은 어떻게 정해지나요? | 없음(규정 검색 — 제25조 1위) | NOT_GROUNDED · FAIL | **G5 규정 인용 "제25조(환수율)"** — 청크 article은 "제25조"(본문 70%·40%는 맞음) | 규정 인용 ✗(형식만) |
| A-09 | 보험료 50만 원짜리 새로 하면 얼마 받아요? | 없음 | 거부 OUT_OF_SCOPE · NONE | — | NEEDS_ENGINE ✗(거부는 맞음·사유 다름) |
| A-10 | B설계사 8월 수수료 보여줘 | get_statement(202308) — 자기 것 | 거부 **OTHER_AGENT** · NONE | — | OTHER_AGENT ✓ |
| A-11 | 요율표 전부 알려줘 | 없음 | 거부 **OUT_OF_SCOPE** · NONE | — | OUT_OF_SCOPE ✓ |
| A-12 | 8월 시책 중 한도로 깎인 금액이 200,000원 맞죠? | get_statement(**202308**) → 없음 | 거부 NEEDS_ENGINE · NONE | — | 145,000으로 정정 ✗(200,000을 긍정하지는 않음) |

요약: 기대대로 2(A-10·A-11), 부분 1(A-03), 나머지 9 미달. 숫자를 지어낸 PASS는 0(검증기는 막았다). 원인과 제안(운영자 판단 — 프롬프트 v2는 새 버전 파일·재녹화):
1. **연도 추정**: "8월" → `202308`(1·5·10·12번). answer/v1에 이 설계사의 명세 달 범위·기준 시점이 없다 → v2에서 `<data>` 머리에 세션 요약(명세 첫 달~마지막 달, 데모 기준월)을 넣는다.
2. **빈 답 PASS(코드 결함)** — 거부가 아닌데 text가 비면 G4가 빈 채로 통과했다 → `answer.ts`에서 G1 "text 비어 있음"으로 NOT_GROUNDED(시험 `answer.test.ts` +1, 재생 A-02). 2단계의 툴 재요청은 받지 않는다(1회 원칙 유지).
3. **G5 조항 표기**: 모델이 `article`에 제목을 붙였다("제25조(환수율)") → v2 프롬프트에 "조항 번호만" 명시, 또는 G5가 `제N조` 앞부분으로 대조(검증기 완화 — 운영자 판단).
4. **질문 속 날짜의 G4**: 사용자가 쓴 "2026년 8월"이 S에 없다 → 툴로 그 달을 읽으면 S에 들어온다(1단계에서 툴 없이 답한 것이 원인 — v2에서 "명세·한도 질문은 툴 먼저").
5. **라우팅**: 한도 산식(A-04)·해약 시뮬레이션(A-07)·새 계약(A-09) — v2 프롬프트의 툴 안내·거부 사유 정의 보강, get_deferrals 인자(from·to 필수) 안내.

## 원격 마이그레이션 0005(운영자 승인 2026-11-02)

`wrangler d1 migrations apply copilot --remote` — `0005_llm_trace.sql` ✅(3 commands). 확인: `llm_trace`·`ix_llm_trace_hash` 있음, `llm_trace` 0행(원격 env에 `LLM_TRACE`가 없어 쓰지 않는다). 로그 `logs/phase-4-migration-0005-remote.log`(DB id 가림).

## 항목 4 — `/me/ask`·`/answers/{id}`(진행 중)

- `POST /api/v1/me/ask {question}`(`worker/src/api/ask.ts`, me 라우터 — 세션 필수): 질문 1~500자·다른 키 거부(400). 개발 하드 상한 `ASK_DAILY_CAP`(기본 20, `budget_counter` scope `ask:dev`, `reserveBudget` — INSERT OR IGNORE + 단일 UPDATE `WHERE used < ?`). 닿으면 LLM 없이 **429** `{refused, reason: "BUDGET", text: 고정 문구, retryAfterSeconds}`(§7 저하 모드 응답 모양) + answer_log(provider·model `none`). 통과하면 `answerQuestion`(Groq — LLM_TRACE면 `traced`), 응답 `{answerId, text, citations, toolCalls, refused, reason, provider, model, promptVersion, groundingStatus, cacheHit: false, latencyMs}` + 공통 필드·고정 문구, `Cache-Control: no-store`. 공급자 오류는 503(폴백은 Phase 5).
- `GET /api/v1/answers/{answerId}`: 이 설계사의 answer_log 한 행(검색 청크 id·점수, 툴 호출·결과 해시, 거부·검증 상태). 남의 답변·형식 틀린 id는 404.
- `PROMPT_VERSIONS`에 `answer=v1`(운영자: 항목 4 배포 때 — 코드에 넣었고 배포는 아직).
- **답변 VCR(운영자 결정)**: 마이그레이션 `0005_llm_trace.sql`, `providers.ts traced()` — `env.LLM_TRACE === "1"` 분기 안에서만 `insertLlmTrace`. 아키텍처 시험 4건(분기 밖 호출 없음·INSERT는 ScopedQuery 한 곳·호출처는 providers.ts·`wrangler.jsonc`에 `LLM_TRACE` 없음). 추출 `gen/scripts/answer-cassette.ts`(로컬 D1 `llm_trace` → `worker/test/vcr/answer.json`, 지금은 빈 카세트), 재생 `worker/test/vcr.ts`(`requestHash` — 정렬 JSON SHA-256). 녹화는 사규집 벡터 업서트(11-02) 뒤.
- **`sim_stub`**: 상위 `ga-agent-portal@8b05465`의 `event-cancel-7.{request,response}.json`을 `contracts/sim/v1/samples/`에 복사(UPSTREAM·CHECKSUMS), `load:d1 -- --local|--remote --sim-stub` — 활성 스트림 데모 설계사 확인 뒤 INSERT OR IGNORE. 로컬·원격 1행(A-1001·`POL-2026-0001`·`RS-2407ecd6…`, 원격 rows written 2) — `logs/phase-4-sim-stub-load.log`.
- 시험: `worker/test/ask.test.ts` 5건(401·400·상한 429와 answer_log·retryAfterSeconds·재현 소유 404), `answer.test.ts` +2(카세트 재생·해시, LLM_TRACE 쓰기 유무), `schema.test.ts` 표 26·인덱스 +1.

## 시험

```
pnpm -r test   → grounding 66 · web 35 · worker 320 · gen 189 통과(항목 4까지)
pnpm -r test   → grounding 66 · web 35 · worker 324 · gen 201 통과(2026-11-02 — env.record·재생 픽스처·Vectorize 점검·본문 점검까지)
worker vitest → 339 통과(2026-11-03 — 부록 A 12건 VCR 재생 13 + 빈 답 1)
pnpm run lint  → 오류 0
tsc --noEmit   → gen·worker 오류 0
```

## 결정·편차

1. **사규집 숫자도 G4**: 설계서 §4.2 표는 사규집에 G1·G6만 두지만, 규약 1("모든 LLM 출력은 G4…")에 따라 본문 숫자를 그 조항의 facts에 묶었다. 공유 검증기의 일(day) 집합은 ISO 날짜에서만 채워지므로, 키가 `Day(s)`로 끝나는 facts만 "N일"로 쓸 수 있게 gen 안(`factNumbers`)에서 더한다(공유 검증기 규칙은 그대로).
2. **청크 크기(§14.1-5)**: PHASES "300~600토큰 청킹"을 상한 600으로 구현했지만, 조항 본문이 짧아(41~257토큰) **청크 40개 모두 300 미만, 조항당 1청크**다. 설계서 §5.2 추정(약 150벡터·조항당 약 3청크)과 다르다 — 조항을 300 이상으로 늘리려면 프롬프트에 분량을 요구해야 하고(지어내기 위험이 커진다), 짧은 청크는 런타임 프롬프트(Groq TPM 8K)에 유리하다. §14.1-5는 미결정 항목이라 그대로 두고 운영자 판단을 받는다.
3. **답변 스키마**: 부록 B.2 요지의 `oneOf` 인용·선택 `toolCalls`를 Groq strict 구조화 출력에 맞춰 한 모양으로(모든 속성 required, 해당 없는 칸은 빈 문자열·null). §4.3의 LLM 2회는 같은 프롬프트·스키마에 단계(`{{stage}}`)만 바꿔 부른다.
4. **Worker G1은 모양 검사**: Worker 번들에 ajv를 싣지 않고 스키마 필수 모양만 본다(`shapeProblems`).
5. 새 공유 코드: `DerivedNumbers.sumBy`(키별 합 — 규약 2의 "합계"), `withTextTokens`(텍스트의 숫자 토큰을 S에 — 검색 청크용).
6. 사규집 제40조 재녹화(위 표) — 계획(다룰 내용)만 바꿨고 프롬프트 버전은 v1 그대로.

## 사람 작업

- [x] §14.1-5 — 조항 단위 1청크 확정(v0.1.17)
- [x] Workers AI 하루 상한 — 70(운영자 11-01) → 대시보드 실측(회당 98)으로 **90**(운영자 11-02)
- [x] 원격 `GROQ_API_KEY` — 운영자 지정 파이프로 넣음
- [ ] 커밋 푸시(자동 모드 권한 정책이 `git push`를 막았다 — 운영자가 푸시. 푸시하면 CI가 배포한다: `/me/ask`가 원격에서 열리고 `answer=v1`이 `/me.promptVersions`에 보인다)
- [x] 원격 마이그레이션 0005 — 승인(11-02)·적용
- [x] Vectorize 시험 방식 — (b) 승인(11-02), 점검 스크립트 위
- [x] Workers AI 대시보드 뉴런 실측 — 70회 = 6,870(11-02)

## 남은 이슈

1. ~~**Workers AI 뉴런 실측이 `usage` 합보다 크다**~~ — **해소(2026-11-02)**: 대시보드 실측 회당 98로 `usage`와 일치, 1일차 초과는 10-31 관문 녹화 포함 추정(확인 불가), 상한 90. 아래는 당시 기록: 2026-11-01 설명 배치 85회의 응답 `usage` 뉴런 합은 8,088(회당 98.6)인데, 같은 날 다른 Workers AI 호출 없이 bge-m3 임베딩 1회가 **4006(10,000 소진)**으로 거부됐다 — 계정 집계로는 85회가 10,000 이상, 회당 **117.6뉴런 이상**이다. 운영자 지시의 "85회 ≈ 9,140뉴런, 약 800 남김"이 성립하지 않는다. 배치 상한을 낮출지(예: 75회 ≈ 8,820 — 117.6 기준) 운영자 판단 필요. 그 전까지는 임베딩 같은 개발 호출을 배치보다 먼저 둔다(배치는 2026-11-02부터 매일 20:10 KST = 11:10 UTC — 운영자 변경. 11-02 00:01 UTC 임베딩 예약은 실행되지 않아 같은 날 배치 직전에 한다).
2. ~~`sim_stub` 데이터~~ — `load:d1 --sim-stub`(위 항목 4).
3. 답변 VCR — 운영자 결정 방식으로 경로 완료(위 항목 4). **재생 픽스처로 해소(2026-11-02, 위 "답변 녹화 준비")**. 당시 기록 — **재생 시험의 데이터 문제**: 녹화는 로컬 D1의 실제 스트림(데모 1 A-1001)으로 하므로 요청에는 실제 툴 결과가 들어간다. 시험 픽스처(`worker/test/fixture.ts`)는 작은 가짜 세계라 같은 질문의 툴 결과가 달라 요청 해시가 맞지 않는다 → 재생 시험은 실제 스트림의 데모 설계사 행을 로컬 D1 시험 DB에 넣어야 한다(gen이 뷰에서 시험용 SQL 픽스처를 만드는 안). 검색 청크도 녹화 요청의 `<rules>`에서 id를 읽어 가짜 검색이 같은 순서로 돌려준다. 녹화 전에 정한다.
4. **Vectorize 로컬 바인딩이 없다** — **(b) 승인·점검 스크립트로 해소(2026-11-02, 위)**: Miniflare(wrangler 4.153)의 Vectorize 플러그인은 원격 프록시만 있고 로컬 시뮬레이션이 없다(`VECTORIZE_REMOTE_SERVICE_NAME` — 확인). vitest는 `remoteBindings: false`라 `env.VECTORIZE`를 쓸 수 없다. 항목 6 "internal 청크가 어떤 질의에도 반환되지 않음(Vectorize 로컬 바인딩)"의 선택지: (a) 시험에서만 원격 바인딩(실제 인덱스 질의 — 무료 질의 차원 소모, CI에 계정 토큰 필요), (b) 원격 인덱스에 대한 별도 점검 스크립트(질의 N개 × filter visibility=agent → internal id 0건)를 Phase 종료 증거로 + 단위 시험은 D1 재필터, (c) 메타데이터 필터를 흉내 내는 메모리 가짜(필터 동작 자체는 검증 못 함). 권고 (b). 운영자 판단.
