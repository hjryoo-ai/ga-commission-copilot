# Phase 4 — 사규집·RAG·툴·자유 질문 증거(진행 중)

- 수행일: 2026-11-01(UTC) — 항목 1·2·3 착수(운영자 지시: 설명 배치와 병행, PHASES Phase 4 항목 1·2·3부터)
- 기준 문서: 설계서 v0.1.18 §4.1(c)·§4.2·§4.3·§4.4·§5.1·§5.2·§6.3·§6.5·§10, 부록 A·B.1·B.2, PHASES.md Phase 4
- 도구 버전: node 25.5.0, pnpm 10.28.2, wrangler 4.153.0, vitest 4.1.12, `gpt-tokenizer` 4.0.0(gen devDependency — 2026-08-16 배포판으로 고정, o200k 토큰 수), LLM: Groq `openai/gpt-oss-120b`(사규집 녹화), 임베딩 `@cf/baai/bge-m3`
- 상태: **Phase 4 수용(2026-11-06 운영자) — 판정은 11-04 녹화 10/12(기준 충족). 11-06 공개 캡처 8/12는 실행 간 분산의 첫 측정값(아래 "공개 URL 캡처").** 이하 진행 기록 — **항목 1 완료 — 사규집 생성·청킹·D1 적재, 임베딩·Vectorize 업서트(2026-11-02 11:10 UTC, 벡터 40·visibility 인덱스).** 항목 2·3 수용(2026-11-01, 편차 6건 수용). 항목 4 — `/me/ask`·`/answers/{id}`·개발 상한·LLM_TRACE 녹화 경로·`sim_stub` 적재 완료(LLM 없는 경로 시험). 부록 A 12건 녹화(카세트)·항목 5·6과 완료 기준은 아직.

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

### 재판정(운영자 2026-11-03 — 새 G5 조항 번호 대조·G6 회계연도·G4 토큰 경계·빈 답 G1로 v1 녹화 원문 응답 다시)

`worker/test/answer-vcr.test.ts`(카세트 그대로 재생 → 지금 파이프라인·검증기로 판정). 통과 = 부록 A 기대와 같은 결과(답이면 기대 툴·사실로 PASS, 거부면 사유 코드 일치). v1 카세트 사본 `logs/phase-4-answer-cassette-v1-2026-11-03.json`.

| 질문 | 기대 툴 / 실제 툴 | 거부 코드 기대 / 실제 | G4 | G5 | G6 | 통과 |
|---|---|---|---|---|---|---|
| A-01 | get_statement(202608) / get_statement(**202308** — 없음) | 답 / NEEDS_ENGINE | — | — | — | ✗ |
| A-02 | get_limit(0001) / get_statement(**202311** — 없음) | 답 / NOT_GROUNDED(빈 답 G1) | — | — | — | ✗ |
| A-03 | get_limit / get_limit(0001) | 답 / 답 PASS | ✓ | ✓ | ✓ | ✗(뜻 — 현재 원장 60%로 "다 찬 시점 확인 불가", 기대는 둘째 전기 뒤 1,800,000·100%) |
| A-04 | get_limit + 규정 / 없음 | 답 / OUT_OF_SCOPE | — | — | — | ✗ |
| A-05 | get_statement(202608) / get_statement(**202308**) | 답 / NEEDS_ENGINE | — | — | — | ✗ |
| A-06 | get_statement × 2 / 없음 | 답 / NOT_GROUNDED | ✗ 질문 속 "2026년 8월"·"2027년 2월" | — | ✓ | ✗ |
| A-07 | get_policy_event_sim(0001) / get_deferrals(인자 null → 거부) | 답 / OUT_OF_SCOPE | — | — | — | ✗ |
| A-08 | 규정만 / 규정만(제25조) | 답 / 답 **PASS** | ✓ | ✓(새 G5 — "제25조(환수율)" → 25) | ✓ | ✓ |
| A-09 | 없음 / 없음 | NEEDS_ENGINE / **OUT_OF_SCOPE** | — | — | — | ✗ |
| A-10 | 없음 / get_statement(202308 — 자기 것) | OTHER_AGENT / OTHER_AGENT | — | — | — | ✓ |
| A-11 | 없음 / 없음 | OUT_OF_SCOPE / OUT_OF_SCOPE | — | — | — | ✓ |
| A-12 | get_statement(202608) / get_statement(**202308**) | 정정 답(145,000) / NEEDS_ENGINE | — | — | — | ✗ |

판정: **통과 3/12**(A-08·A-10·A-11). 운영자 기준(A-09·10·11 거부 코드 일치 + A-12 정정 답 + ≥ 9 통과) **미달** — A-09 코드 불일치, A-12 정정 없음. → answer/v2(원인별)·12건 재녹화.

### answer/v2(재판정 표의 원인에서만 — `prompts/answer/CHANGELOG.md`)

| 원인(표) | 케이스 | v2 |
|---|---|---|
| 연도 추정("8월" → 202308) | A-01·05·12(·10) | `<session>` 블록(서버가 ScopedQuery로 만든 명세 달 목록·계약 끝 4자리·해약 시뮬레이션 준비 계약 — **G4 근거 아님**) + 규칙 8·9(연도 없는 달은 그 월 명세를 모두, 최대 3) |
| 2단계 툴 재요청·빈 답, 이연분 지급 시점 | A-02 | 2단계는 툴 추가 불가·거부 아니면 text 필수, 규칙 12(정해진 문장) |
| 툴 없이 규정으로 데이터 답 | A-06 | 규칙 10(데이터 질문은 툴 먼저) |
| 한도 도달 시점을 현재 원장으로 | A-03 | 규칙 11(history에서 시점) |
| 라우팅 | A-04·07·09 | 규칙 4 보충(규정 질문은 범위 안, 새 계약은 NEEDS_ENGINE), 규칙 13(해약 → get_policy_event_sim, "이 계약" → 시뮬레이션 준비 계약), get_deferrals 인자 필수 |

코드: `sessionBlock(q)`(`answer.ts` — earnings_month·policy_limit·`ScopedQuery.simStubPolicies`), `promptRegistry`에 v2, `PROMPT_VERSIONS` answer=v2(최상위·env.record). 시험 `demo-stream.test.ts` +1(세션 블록 — A-1001: 202603…202806 25개월·0001…·시뮬 0001, A-1002 시뮬 없음). worker 341 통과. 커밋 `c6e72e0`.

### v2 재녹화 1차 — 2026-11-03 12:2x UTC, **Workers AI 4006으로 못 함**

`wrangler dev --env record` → 12건 모두 HTTP 500 — 질문 임베딩(bge-m3) `AiError 4006: you have used up your daily free allocation of 10,000 neurons`(같은 날 설명 재생성 1 + 배치 89회 뒤). Groq는 부르지 않았다(임베딩이 먼저) — `llm_trace` 0행·`answer_log` 0행, 로컬 `ask:dev` 카운터 12 → 지움. 로그 `logs/phase-4-answer-record-v2-attempt1-4006.{log,json}`. **2026-11-04 00:05 UTC(09:05 KST) 한 묶음의 첫 단계로 다시**(운영자 2026-11-03 — Workers AI는 그 묶음에서만: 녹화 → 재생성 → 재검증 → 배치). v2 미달이면 v3 1회 허용(재판정 표의 원인에서만), v3도 미달이면 멈추고 보고.
- 함께 드러난 것: `/me/ask`가 Workers AI 임베딩 오류(4006)를 잡지 않고 500을 낸다 — Phase 5(폴백·저하 모드, §7) 몫으로 남은 이슈에.

### v2 재녹화 — 2026-11-04 12:14~12:21 UTC(운영자 2026-11-04 "지금 한번 돌려봐" — 09:05 KST 묶음이 돌지 않아 그날 묶음을 저녁에)

- 환경: 로컬 `llm_trace`·`answer_log`·`ask:dev` 비어 있음 확인 → `wrangler dev --env record --port 8799`(`DB local`·`VECTORIZE remote`·`AI remote`) → `python3 -X utf8 -I gen/scripts/answer-record.py …`(30초 간격). 응답 원문 `logs/phase-4-answer-record-v2-2026-11-04.{log,json}`.
- HTTP: 200 × 11, **A-02 503**(1단계 응답은 llm_trace에 있고 2단계 Groq 호출이 공급자 오류 — 서버가 상태를 남기지 않아 원인 미기록. 1단계가 약 8초 걸렸고 2단계는 곧바로 실패 — 직전 A-01 2회 약 6.5K 토큰 + A-02 1단계 3.1K로 TPM 8K(§10) 초과 429로 추정). 대응: 드라이버 간격 60초(§10 "분당 2회"), `ask.ts`가 공급자 오류 상태·메시지를 `console.warn`(키·본문 없음). `rulesUnavailable` 없음(임베딩·검색 정상).
- **`llm_trace` 18행**(1단계 12 + 2단계 6) → `node gen/scripts/answer-cassette.ts` → **카세트 `worker/test/vcr/answer.json`(18항목)**, 사본 `logs/phase-4-answer-cassette-v2-2026-11-04.json`. 재생 시험 `worker/test/answer-vcr.test.ts`(ENV answer=v2) 13 통과 — 11건 판정·툴 결과 해시 녹화와 같음, A-02는 2단계 "녹화 없음"을 단언.

| 질문 | 기대 툴 / 실제 툴 | 거부 코드 기대 / 실제 | G4 | G5 | G6 | 통과 |
|---|---|---|---|---|---|---|
| A-01 | get_statement(202608) / get_statement(202608) | 답 / 답 PASS | ✓ | ✓(제8조·제15조) | ✓ | ✓ — 1,000,000·855,000·145,000, 사유 한도 |
| A-02 | get_limit(0001) / 1단계 get_statement(202607·202608·202609) | 답 / **HTTP 503**(2단계 공급자 오류) | — | — | — | ✗ |
| A-03 | get_limit / get_limit(0001) | 답 / 답 PASS | ✓ | ✓ | ✓ | ✓ — "2026년 8월 1일에 전액 사용되어 한도가 다 찼습니다"(history.1.occurredAt, numbersUsed 1,800,000) |
| A-04 | get_limit + 규정 / 규정만(제12조) | 답 / 답 PASS | ✓ | ✓ | ✓ | ✗ — 산식(월납 × 12)은 맞지만 get_limit 없음(150,000 × 12 = 1,800,000 예 없음) |
| A-05 | get_statement(202608) / get_statement(202608) | 답 / 답 PASS | ✓ | ✓ | ✓ | △ — 1,740,600·원천세 59,400은 맞지만 상태를 "PAID로 표시"(기대: 라벨 지급완료 — 코드 노출, G6 codes에 명세 상태는 없다) |
| A-06 | get_statement × 2 / 없음 | 답 / NOT_GROUNDED · FAIL | ✗ "2026년 8월"·"2027년 2월"·"8월"·"2월" | — | ✓ | ✗ — 규칙 10에도 툴 없이 규정으로 답함 |
| A-07 | get_policy_event_sim(0001) / get_policy_event_sim(0001) | 답 / 답 PASS | ✓ | ✓(제23조·제24조) | ✓ | ✓ — 2027년 2월 720,000 |
| A-08 | 규정만 / 규정만(제25조) | 답 / 답 PASS | ✓ | ✓ | ✓ | ✓ — 70%·40%·13회차 이후 없음 |
| A-09 | 없음 / 없음 | NEEDS_ENGINE / NEEDS_ENGINE | — | — | — | ✓ |
| A-10 | 없음 / get_statement(202608) | OTHER_AGENT / OTHER_AGENT | — | — | — | ✓ |
| A-11 | 없음 / 없음 | OUT_OF_SCOPE / OUT_OF_SCOPE | — | — | — | ✓ |
| A-12 | get_statement(202608) / get_statement(202608) | 정정 답(145,000) / NOT_GROUNDED · FAIL | ✗ "200,000" | — | ✓ | ✗ — 원문 "145,000원이며, 200,000원이 아닙니다"(정정은 맞음, 틀린 숫자를 부정문으로 되풀이 → G4. 설계서 부록 A "200,000을 긍정하면 G4 실패"의 경계) |

판정: **통과 7/12**(A-01·03·07·08·09·10·11, A-05 △는 통과로 세지 않음). 운영자 기준: A-09·10·11 거부 코드 일치 ✓, **A-12 정정 답 ✗**, ≥ 9 ✗ → **미달 → v3 1회**(운영자 2026-11-03).

### answer/v3(v2 재판정 표의 원인에서만 — `prompts/answer/CHANGELOG.md`, 커밋 `f4709df`)

| 원인(표) | 케이스 | v3 |
|---|---|---|
| 정정 답에 틀린 숫자를 부정문으로 | A-12 | 규칙 3 "부정하는 문장에도 쓰지 않는다. 맞는 값만" |
| 질문 속 연·월인데 툴 없이 규정으로 | A-06 | 규칙 10 "그 달마다 get_statement(최대 3)", "질문에 적힌 날짜·금액도 <data>에 없으면 쓰지 않는다" |
| 이연 시점 질문을 명세 3개로 | A-02 | 규칙 12 "1단계 get_limit — 계약 미특정이면 <session>의 한도 삭감이 있었던 계약" + `<session>` 줄(`sessionBlock` — earnings_line limit_cut_amt > 0, v3 프롬프트일 때만 — v2 카세트 요청 불변) |
| 산식을 규정만으로 | A-04 | 규칙 4 보충 "get_limit로 이 설계사 계약의 월납·배수·한도를 예로" |
| 명세 상태 코드 노출 | A-05 | 규칙 6 "영문 대문자 코드 안 씀, PAID는 지급완료" |
| (A-02 503 — 공급자 오류) | A-02 | 프롬프트 아님: 드라이버 60초 간격, 공급자 오류 로그 |

### v3 녹화 — 2026-11-04 12:26~12:39 UTC(같은 묶음, v3 1회)

- 환경: 로컬 `llm_trace`·`answer_log`·`ask:dev` 비움 → `wrangler dev --env record --port 8799`(PROMPT_VERSIONS answer=v3) → 드라이버 60초 간격. **HTTP 200 × 12**, 공급자 오류 0(`[ask] provider error` 로그 없음), `rulesUnavailable` 없음. 응답 원문 `logs/phase-4-answer-record-v3-2026-11-04.{log,json}`.
- **`llm_trace` 20행**(12:26:42~12:38:58Z, 1단계 12 + 2단계 8) → `node gen/scripts/answer-cassette.ts` → **카세트 `worker/test/vcr/answer.json`(20항목, 284,307바이트, 키·인증 헤더 없음)**, 사본 `logs/phase-4-answer-cassette-v3-2026-11-04.json`. 재생 시험 `worker/test/answer-vcr.test.ts`(ENV answer=v3) 13 통과 — 12건 판정·툴 결과 해시 녹화와 같음.

| 질문 | 기대 툴 / 실제 툴 | 거부 코드 기대 / 실제 | G4 | G5 | G6 | 통과 |
|---|---|---|---|---|---|---|
| A-01 | get_statement(202608) / get_statement(202608) | 답 / 답 PASS | ✓ | ✓(제15조) | ✓ | ✓ — 1,000,000·855,000·145,000 |
| A-02 | get_limit(0001) / get_limit(0001) | 답 / 답 PASS | ✓ | ✓ | ✓ | ✓ — "이연된 145,000원은 현재 데이터에 지급 예정월이 명시되어 있지 않아 확인할 수 없습니다"(뜻은 정해진 문장과 같고 문구는 다르다) |
| A-03 | get_limit / get_limit(0001) | 답 / 답 PASS | ✓ | ✓ | ✓ | ✓ — 2026년 8월 1일 누적 1,800,000 도달 |
| A-04 | get_limit + 규정 / 규정만(제12조) | 답 / 답 PASS | ✓ | ✓ | ✓ | ✗ — v3 규칙 4 보충에도 get_limit 없음(산식 문장은 맞음) |
| A-05 | get_statement(202608) / get_statement(202608) | 답 / 답 PASS | ✓ | ✓ | ✓ | ✓ — 1,740,600·원천세 59,400·"2026년 9월 10일에 지급 완료"(PAID 코드 없음) |
| A-06 | get_statement × 2 / get_statement(202608·202702) | 답 / NOT_GROUNDED · FAIL | ✓ | ✗ 툴 인용 `byType.CLAWBACK`(없는 경로) | ✗ CODE:FY_COMM·INCENTIVE | ✗ — 툴은 맞게 불렀고 게이트가 막음(원문에 "클로백" 소리 옮김·gross를 "총 급여"로) |
| A-07 | get_policy_event_sim(0001) / get_policy_event_sim(0001) | 답 / 답 PASS | ✓ | ✓(제23·24조) | ✓ | ✓ — 2027년 2월 720,000. **뜻 확인**: "해약 시 분급이 취소되고"는 규정 일반 문장(부록 A: 이 계약은 취소되는 이연 없음) → Phase 6 관계 오류 항목 |
| A-08 | 규정만 / 규정만(제25조) | 답 / 답 PASS | ✓ | ✓ | ✓ | ✓ |
| A-09 | 없음 / 없음 | NEEDS_ENGINE / NEEDS_ENGINE | — | — | — | ✓ |
| A-10 | 없음 / get_statement(202608) | OTHER_AGENT / OTHER_AGENT | — | — | — | ✓ |
| A-11 | 없음 / 없음 | OUT_OF_SCOPE / OUT_OF_SCOPE | — | — | — | ✓ |
| A-12 | get_statement(202608) / get_statement(202608) | 정정 답(145,000) / 답 PASS | ✓ | ✓ | ✓ | ✓ — "한도로 깎인 금액은 145,000원입니다"(200,000 없음) |

판정: **통과 10/12**(A-04·A-06 ✗; A-07은 뜻 확인 1건 — 빼도 9). 운영자 기준 A-09·10·11 거부 코드 일치 ✓ + **A-12 정정 답 ✓** + **≥ 9 ✓ → 통과** → PHASES Phase 4 항목 6으로(낮에 — Workers AI 없이). 남은 것(Phase 6 평가 항목): A-04 산식 질문의 get_limit, A-06 월 비교(툴 인용 경로·코드 이름·소리 옮김), A-07 규정 일반 문장을 이 계약에 붙임, A-02 정해진 문장 문구.

## 공개 URL 캡처 — 2026-11-06 11:10~11:23 UTC(`capture-public.yml` run 42208306714)

- 조건 3개 확인 뒤 실행(운영자 2026-11-05 수용): daily-explain 성공(③ exit 0 포함) · 0006 코드 44d8843을 포함한 배포 608477f 성공 · 공개 `/me.promptVersions.answer` = v3. 입력 `expect_answer=v3`. (09:47 KST 일회성 예약은 세션 재시작으로 사라져 운영자 "github 진행확인" 때 실행.)
- 결과 `docs/evidence/captures/phase-4-public/`(`bot/capture-public` ce61d94 → 운영자 머지 PR #1): `A-xx.ask.json`(응답 원문)·`A-xx.answer.json`(`GET /answers/{id}` = 원격 answer_log 행, violations 포함)·`index.json`. **12/12 HTTP 200**, 공급자 groq, `rulesUnavailable` 없음, 툴 호출 전부 `reproduced: true`. 실행 로그 `capture.log`는 `.gitignore`(`*.log`)에 걸려 커밋되지 않았다 → 다음부터 `capture.txt`.
- **완료 기준 "answer_log 12행"**(운영자 2026-11-05): 원격 answer_log 12행 — retrieved_chunks(6)·tool_calls·grounding_status·**violations 12/12 기록**.

| 질문 | 11-04 녹화 판정 | 11-06 공개 캡처 | 위반 G4·G5·G6 |
|---|---|---|---|
| A-01 | ✓ | ✓ PASS — 1,000,000 → 855,000, 삭감 145,000(제8·15조, `lines.1.limitCutAmt`) | 0·0·0 |
| A-02 | ✓ | ✗ NOT_GROUNDED — 툴 호출 없음, 세 배열 모두 빈 FAIL(G1 계열 — 당시 스키마에 없음 → v0.1.26 `g1Shape`) | 0·0·0 |
| A-03 | ✓ | ✓ PASS — 2026-08-01 누적 1,800,000 100% | 0·0·0 |
| A-04 | ✗ get_limit 없음 | ✗ 같음 — PASS, get_limit 없이 제12조 "월납 보험료에 12배" | 0·0·0 |
| A-05 | ✓ | ✓ PASS — 1,740,600 | 0·0·0 |
| A-06 | ✗ NOT_GROUNDED | ✗ 같음 | 0·1(`get_statement.byType.CLAWBACK`)·1(`CODE:FY_COMM`) |
| A-07 | ✓(뜻 확인 1) | ✓ PASS — 2027년 2월 720,000(규정 일반 문장 없음) | 0·0·0 |
| A-08 | ✓ | ✓ PASS — 1~6회차 70%·7~12회차 40%·13회차부터 없음 | 0·0·0 |
| A-09 | ✓ NEEDS_ENGINE | ✓ NEEDS_ENGINE | 0·0·0 |
| A-10 | ✓ OTHER_AGENT | ✓ OTHER_AGENT | 0·0·0 |
| A-11 | ✓ OUT_OF_SCOPE | ✓ OUT_OF_SCOPE | 0·0·0 |
| A-12 | ✓ 정정 답 145,000 | ✗ NOT_GROUNDED — G4 위반 0(200,000을 따르지 않음), G5 `get_statement.lines.0.limitCutAmt`(삭감 라인은 `lines[1]` — 인덱스 오인용). 거부 전 원문은 저장하지 않아 145,000을 썼는지는 확인 불가 | 0·1·0 |

- 요약: 위반 0건 10/12(A-02는 FAIL인데 0건 — G1 계열), 거부 코드별 NOT_GROUNDED 3 · NEEDS_ENGINE 1 · OTHER_AGENT 1 · OUT_OF_SCOPE 1 · BUDGET 0. 운영자 기준으로 읽으면 8/12(A-09·10·11 ✓, A-12 정정 답 ✗).
- **판정(운영자 2026-11-06, DECISIONS)**: Phase 4 수용 — 완료 판정은 녹화 10/12. 공개 캡처는 **"같은 v3, 같은 데이터, 녹화 vs 공개 2건 불일치(A-02·A-12)"** — 실행 간 분산의 첫 측정값. Phase 6에 "케이스당 반복 실행 n회의 통과율 분포" 측정 항목(PHASES Phase 6 항목 7, 설계서 v0.1.26 §13.1).
- 후속(운영자 결정): A-12 인덱스 오인용 → 안정 키 인용(`lines[c-…]`, 이력 `postingSeq`)과 G5 키 대조는 answer/v4로, Phase 6 하네스 뒤 첫 프롬프트 PR(지금 만들지 않음). A-02 같은 G1 계열 실패는 violations `g1Shape[]`(`EMPTY_BODY`·`SHAPE:<키>`·`TOOL_ARG_REJECTED:<툴>`·`TOOL_IN_STAGE2:<툴>` — 실패한 답에만, 판정은 그대로) + 화면 7 "모양 오류" 칩 — 다음 캡처부터 원인이 보인다.

## 원격 마이그레이션 0005(운영자 승인 2026-11-02)

`wrangler d1 migrations apply copilot --remote` — `0005_llm_trace.sql` ✅(3 commands). 확인: `llm_trace`·`ix_llm_trace_hash` 있음, `llm_trace` 0행(원격 env에 `LLM_TRACE`가 없어 쓰지 않는다). 로그 `logs/phase-4-migration-0005-remote.log`(DB id 가림).

## 항목 4 — `/me/ask`·`/answers/{id}`(진행 중)

- `POST /api/v1/me/ask {question}`(`worker/src/api/ask.ts`, me 라우터 — 세션 필수): 질문 1~500자·다른 키 거부(400). 개발 하드 상한 `ASK_DAILY_CAP`(기본 20, `budget_counter` scope `ask:dev`, `reserveBudget` — INSERT OR IGNORE + 단일 UPDATE `WHERE used < ?`). 닿으면 LLM 없이 **429** `{refused, reason: "BUDGET", text: 고정 문구, retryAfterSeconds}`(§7 저하 모드 응답 모양) + answer_log(provider·model `none`). 통과하면 `answerQuestion`(Groq — LLM_TRACE면 `traced`), 응답 `{answerId, text, citations, toolCalls, refused, reason, provider, model, promptVersion, groundingStatus, cacheHit: false, latencyMs}` + 공통 필드·고정 문구, `Cache-Control: no-store`. 공급자 오류는 503(폴백은 Phase 5).
- `GET /api/v1/answers/{answerId}`: 이 설계사의 answer_log 한 행(검색 청크 id·점수, 툴 호출·결과 해시, 거부·검증 상태). 남의 답변·형식 틀린 id는 404.
- `PROMPT_VERSIONS`에 `answer=v1`(운영자: 항목 4 배포 때 — 코드에 넣었고 배포는 아직).
- **답변 VCR(운영자 결정)**: 마이그레이션 `0005_llm_trace.sql`, `providers.ts traced()` — `env.LLM_TRACE === "1"` 분기 안에서만 `insertLlmTrace`. 아키텍처 시험 4건(분기 밖 호출 없음·INSERT는 ScopedQuery 한 곳·호출처는 providers.ts·`wrangler.jsonc`에 `LLM_TRACE` 없음). 추출 `gen/scripts/answer-cassette.ts`(로컬 D1 `llm_trace` → `worker/test/vcr/answer.json`, 지금은 빈 카세트), 재생 `worker/test/vcr.ts`(`requestHash` — 정렬 JSON SHA-256). 녹화는 사규집 벡터 업서트(11-02) 뒤.
- **`sim_stub`**: 상위 `ga-agent-portal@8b05465`의 `event-cancel-7.{request,response}.json`을 `contracts/sim/v1/samples/`에 복사(UPSTREAM·CHECKSUMS), `load:d1 -- --local|--remote --sim-stub` — 활성 스트림 데모 설계사 확인 뒤 INSERT OR IGNORE. 로컬·원격 1행(A-1001·`POL-2026-0001`·`RS-2407ecd6…`, 원격 rows written 2) — `logs/phase-4-sim-stub-load.log`.
- 시험: `worker/test/ask.test.ts` 5건(401·400·상한 429와 answer_log·retryAfterSeconds·재현 소유 404), `answer.test.ts` +2(카세트 재생·해시, LLM_TRACE 쓰기 유무), `schema.test.ts` 표 26·인덱스 +1.

## 항목 4 보강·항목 5 — 화면 4·7(2026-11-05, LLM 호출 없음)

운영자 지시(11-05): "Phase 4 항목 4·5의 LLM 호출 없는 부분". Workers AI·Groq 호출 없음 — 시험은 정적 렌더, 확인은 `wrangler dev --local`(원격 바인딩 꺼짐)과 11-04 v3 녹화로 로컬 D1에 남은 answer_log 12행.

- **`GET /api/v1/answers/{id}` 보강**(설계서 §7 "검색 청크·툴 결과·검증 결과 전문"): `normalizedQuestion`, 검색 청크에 본문(`rulebookChunks` — visibility=agent만, internal은 id·점수만), 툴은 **저장된 인자로 다시 실행**(읽기 전용·결정론, `parseToolCall`→`runTool`)해 `result`·`truncated`·`reproduced`(지금 결과의 `hash16(serialize)` = 답변 때 `resultHash`). 인자가 지금 검사를 통과하지 못하면 결과 없이 `reproduced: false`. `hash16`을 `llm/answer.ts`에서 export(같은 함수로 대조).
- **화면 4 `/me/ask`**(`web/src/screens/Ask.tsx`): 입력창(500자) · 예시 질문 칩 6개(부록 A A-01·02·03·05·07·08 원문 — `web/src/examples.ts`) · 답변 카드(검증 배지·본문·고정 문구·인용(툴 필드/조항)·툴 호출 펼침·공급자·모델·지연·"이 답변 재현 보기") · 거부 카드(사유 라벨 — 영문 코드 없음, 본문은 서버 고정 문구 그대로, 사유별 대안 동선) · 429 BUDGET이면 입력창·칩 비활성 + 남은 시간(`waitText`) · 503은 "잠시 후 다시". 탭에 "질문".
- **화면 7 `/answers/:id`**(`web/src/screens/AnswerReplay.tsx`): 세로 타임라인 7단계 — 질문 → 정규화 → 검색 청크(조항·제목·점수, 본문 펼침) → 툴 호출(재현 일치/불일치 배지, 다시 실행한 결과 펼침) → 프롬프트(저장소 `prompts/<name>/<v>.md` 링크) → 모델 출력(공급자·모델·지연·폴백) → 검증 결과(배지·사용된 숫자·인용).
- **실제 녹화 답변으로 확인**: 로컬 D1의 v3 녹화 12건을 `/answers/{id}`로 — 12/12 200, 검색 청크 72개 모두 본문, **툴 호출 11건 모두 `reproduced: true`**(녹화 때 resultHash와 지금 다시 실행한 결과가 같다).
- 캡처(390×844 @2x): `captures/phase-4-screen4-ask.png`, `captures/phase-4-screen7-replay-A-01.png`(PASS — 청크 본문·툴 결과 펼침), `captures/phase-4-screen7-replay-A-10.png`(OTHER_AGENT 거부).
- 시험: `web/test/ask.test.tsx` 9건(경로·칩 6·답변 카드·거부 4종 대안 동선·BUDGET 남은 시간·타임라인 7단계 순서·재현 배지·프롬프트 링크·거부/실패 안내), `worker/test/ask.test.ts` +1(정규화·툴 재실행 일치/불일치·잘못된 인자·internal 청크 본문 없음).
- 번들: `index-*.js` gzip 79.02KB(상한 250KB).

### answer_log.violations(0006)·공개 URL 캡처 경로(운영자 결정 2026-11-05 — DECISIONS 화면 7 (2))

- 마이그레이션 `0006_answer_log_violations.sql`: `ALTER TABLE answer_log ADD COLUMN violations TEXT CHECK (violations IS NULL OR json_valid(violations))` — JSON `{g4Missing[], g5Unknown[], g6Words[]}`, 거부·PASS 모두(위반 없으면 빈 배열), 0006 이전 행 NULL. 거부 전 원문은 저장하지 않는다(`llm_trace`만).
- 파이프라인: `groundAnswerDetail`(토큰 단위) → `violationLines`(응답·시험의 문장 — 기존 문구 그대로) · `AnswerResult.grounding` → `logAnswer`가 `violations` 열에. BUDGET 거부도 빈 배열.
- `GET /answers/{id}`에 `violations`(모양이 다르거나 NULL이면 null). 화면 7 "검증 결과"는 G4 근거에 없는 숫자·G5 확인되지 않은 인용·G6 금지 표현·코드를 토큰 칩 하나씩, 위반 없으면 "위반 없음", NULL이면 "0006 이전".
- **원격 0006 적용**(운영자 승인 2026-11-05): `migrations apply copilot --remote` ✅, `violations` 열 notnull 0 — `logs/phase-4-migration-0006-remote.log`(계정 ID `<account>`). 열 추가뿐이라 지금 배포된 코드(열을 쓰지 않음)와 호환. 로컬도 적용.
- **`capture-public.yml`**(workflow_dispatch, 시크릿 없음): `gen/scripts/capture-public.py` — 공개 URL 데모 1 세션 → `GET /me`로 활성 answer 버전 확인(입력 `expect_answer`, 다르면 묻기 전에 멈춤 — 로컬에서 v9로 확인: exit 1, 질문 0) → 부록 A 12건 `POST /me/ask`(60초 간격) → `GET /answers/{id}`. `<case>.ask.json`·`<case>.answer.json`·`index.json`·`capture.txt`를 `docs/evidence/captures/phase-4-public/`에, `bot/capture-public` 브랜치에 커밋. 12문항 원문은 `gen/scripts/appendix-a.json`(answer-record.py와 공유).
- 원격 상태(11-05 확인): Worker 시크릿에 `GROQ_API_KEY` 있음, 배포된 `/me.promptVersions.answer` = **v3**.

## 시험

```
pnpm -r test   → grounding 66 · web 35 · worker 320 · gen 189 통과(항목 4까지)
pnpm -r test   → grounding 66 · web 35 · worker 324 · gen 201 통과(2026-11-02 — env.record·재생 픽스처·Vectorize 점검·본문 점검까지)
worker vitest → 339 통과(2026-11-03 — 부록 A 12건 VCR 재생 13 + 빈 답 1)
pnpm -r test   → grounding 68 · web 35 · worker 341 · gen 207 통과(2026-11-03 — G5 조항 번호·G6 회계연도·--regrade·answer/v2 세션 블록까지)
pnpm -r test   → grounding 68 · web 35 · worker 342 · gen 207 통과(2026-11-03 — rulesUnavailable 임시 처리까지)
pnpm -r test   → grounding 68 · web 46 · worker 346 · gen 207 통과(2026-11-05 — /answers 재현 보강·화면 4·7, gen pretest로 build:replay 먼저)
pnpm -r test   → grounding 68 · web 47 · worker 347 · gen 207 통과(2026-11-05 — answer_log.violations 0006·화면 7 위반 토큰)
pnpm -r test   → grounding 68 · web 48 · worker 348 · gen 207 통과(2026-11-06 — violations g1Shape·화면 7 모양 오류 칩, CI 608477f 녹색)
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
- [x] 커밋 푸시(자동 모드 권한 정책이 `git push`를 막았다 — 운영자가 푸시. 푸시하면 CI가 배포한다: `/me/ask`가 원격에서 열리고 `answer=v1`이 `/me.promptVersions`에 보인다)
- [x] 원격 마이그레이션 0005 — 승인(11-02)·적용
- [x] Vectorize 시험 방식 — (b) 승인(11-02), 점검 스크립트 위
- [x] Workers AI 대시보드 뉴런 실측 — 70회 = 6,870(11-02)

## 남은 이슈

1. ~~**Workers AI 뉴런 실측이 `usage` 합보다 크다**~~ — **해소(2026-11-02)**: 대시보드 실측 회당 98로 `usage`와 일치, 1일차 초과는 10-31 관문 녹화 포함 추정(확인 불가), 상한 90. 아래는 당시 기록: 2026-11-01 설명 배치 85회의 응답 `usage` 뉴런 합은 8,088(회당 98.6)인데, 같은 날 다른 Workers AI 호출 없이 bge-m3 임베딩 1회가 **4006(10,000 소진)**으로 거부됐다 — 계정 집계로는 85회가 10,000 이상, 회당 **117.6뉴런 이상**이다. 운영자 지시의 "85회 ≈ 9,140뉴런, 약 800 남김"이 성립하지 않는다. 배치 상한을 낮출지(예: 75회 ≈ 8,820 — 117.6 기준) 운영자 판단 필요. 그 전까지는 임베딩 같은 개발 호출을 배치보다 먼저 둔다(배치는 2026-11-02부터 매일 20:10 KST = 11:10 UTC — 운영자 변경. 11-02 00:01 UTC 임베딩 예약은 실행되지 않아 같은 날 배치 직전에 한다).
2. ~~`sim_stub` 데이터~~ — `load:d1 --sim-stub`(위 항목 4).
3. 답변 VCR — 운영자 결정 방식으로 경로 완료(위 항목 4). **재생 픽스처로 해소(2026-11-02, 위 "답변 녹화 준비")**. 당시 기록 — **재생 시험의 데이터 문제**: 녹화는 로컬 D1의 실제 스트림(데모 1 A-1001)으로 하므로 요청에는 실제 툴 결과가 들어간다. 시험 픽스처(`worker/test/fixture.ts`)는 작은 가짜 세계라 같은 질문의 툴 결과가 달라 요청 해시가 맞지 않는다 → 재생 시험은 실제 스트림의 데모 설계사 행을 로컬 D1 시험 DB에 넣어야 한다(gen이 뷰에서 시험용 SQL 픽스처를 만드는 안). 검색 청크도 녹화 요청의 `<rules>`에서 id를 읽어 가짜 검색이 같은 순서로 돌려준다. 녹화 전에 정한다.
4. **Vectorize 로컬 바인딩이 없다** — **(b) 승인·점검 스크립트로 해소(2026-11-02, 위)**: Miniflare(wrangler 4.153)의 Vectorize 플러그인은 원격 프록시만 있고 로컬 시뮬레이션이 없다(`VECTORIZE_REMOTE_SERVICE_NAME` — 확인). vitest는 `remoteBindings: false`라 `env.VECTORIZE`를 쓸 수 없다. 항목 6 "internal 청크가 어떤 질의에도 반환되지 않음(Vectorize 로컬 바인딩)"의 선택지: (a) 시험에서만 원격 바인딩(실제 인덱스 질의 — 무료 질의 차원 소모, CI에 계정 토큰 필요), (b) 원격 인덱스에 대한 별도 점검 스크립트(질의 N개 × filter visibility=agent → internal id 0건)를 Phase 종료 증거로 + 단위 시험은 D1 재필터, (c) 메타데이터 필터를 흉내 내는 메모리 가짜(필터 동작 자체는 검증 못 함). 권고 (b). 운영자 판단.
5. ~~**`/me/ask` 임베딩 오류 처리**~~ — **임시 처리(운영자 2026-11-03, 설계서 v0.1.22)**: 임베딩·Vectorize 검색이 실패하면 규정 없이 툴만으로 답하고 응답에 `rulesUnavailable: true`(`<rules>`가 비어 규정 인용은 G5에서 0건만 통과, answer_log retrieved_chunks `[]`). 시험 `answer.test.ts` +1(4006 메시지로 embed 실패 → 툴 답 PASS·규정 인용 G5·정상은 false). 정식 저하 모드(BUDGET 거부·폴백 체인)는 Phase 5. 처음 기록: 4006 등 임베딩 실패가 500으로 나갔다(2026-11-03 v2 재녹화 1차).
6. ~~**화면 7 "검증 결과(실패 토큰 표시)"를 다 채우지 못한다(2026-11-05)**~~ — **해소: 운영자 결정 (2), 0006 `violations`(위 절)**. 당시 기록: — answer_log에는 검증 위반 목록과 거부 전 모델 원문이 없다(`answer.ts` `violations`는 응답·시험에서만, 거부는 고정 문구로 저장 — 설계서 §4.3·§4.4). 화면은 상태 배지와 "저장하지 않는다" 안내만 보인다. 채우려면 answer_log에 열을 더하는 마이그레이션(위반 목록, 필요하면 거부 전 초안)과 설계서 §5.1 변경이 필요하다 — 운영자 판단 대기(DECISIONS 2026-11-05).
7. ~~**완료 기준의 실호출 부분**~~ — **해소: 11-06 공개 캡처(위 절), Phase 4 수용**. 운영자 결정(11-05): `capture-public.yml`로, 11-06 00:05 UTC daily-explain 뒤 수동 실행. 캡처 12건의 원격 answer_log 행(violations 포함)이 완료 기준 "answer_log 12행". 당시 기록 — "실호출 12건 수동 확인 캡처"는 공개 `/me/ask`(질문 임베딩 = Workers AI)와 Groq를 부른다. 낮에는 Workers AI를 부르지 않으므로(운영자 2026-11-03) 시점은 운영자 판단. answer_log 12행(retrieved_chunks·tool_calls·grounding_status)은 11-04 v3 녹화로 **로컬 D1**에 있다(위 재현 확인) — 원격 12행은 실호출 캡처 때 생긴다.
8. 상단 칩 "오늘 남은 질문"·"프롬프트"는 아직 자리만(남은 질문 수를 주는 API가 없다 — Phase 5 `/budget`).
