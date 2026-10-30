# PHASES.md — Claude Code Phase별 지시 프롬프트

사용법: 아래 블록을 **그대로** Claude Code에 붙여 넣는다. 각 블록은 설계서 섹션 참조 · 절대 규약(CLAUDE.md) · 골든 케이스 · 완료 기준을 포함한다. 한 Phase가 끝나면 `docs/evidence/phase-N.md`를 확인한 뒤 다음 블록으로 넘어간다.

공통 머리말(모든 블록 앞에 붙는 것으로 간주):

> `CLAUDE.md`의 절대 규약 10개를 먼저 읽는다. 정본은 `docs/GA수수료설명코파일럿_설계서.md`다. 아래 지시 범위 밖의 파일은 만들지 않는다. 완료 기준을 테스트로 증명하고 `docs/evidence/phase-N.md`에 명령·출력을 남긴다. 미결정 사항(§14.1)을 만나면 `docs/DECISIONS.md`에 선택지를 적고 멈춘다.
> 이 문서의 수치(금액·건수·seq)가 설계서와 다르면 설계서 부록 A가 정본이다.

---

## Phase 0 — 골격·한도 재확인

```
설계서 §3.3(저장소 구조), §5.1(D1 스키마), §10(무료 한도), §11(기술 스택)을 읽고 다음을 만든다.

1. 모노레포 골격: pnpm workspace(worker, web, gen, evals), projection-java(Gradle, 빈 모듈, Java 25 툴체인 선언만 — 루트 `pnpm -r test`에서 제외), contracts/, prompts/, data/, docs/evidence/.
2. worker: Hono 4.13.x, wrangler.jsonc(D1 `copilot`, Vectorize `rulebook-v1` 1024차원 cosine, AI 바인딩, Assets 바인딩 → ../web/dist, nodejs_compat). `GET /api/v1/health`가 {ok:true, d1: SELECT 1 결과}를 돌려준다.
3. D1 마이그레이션 0001: 상위 설계서 §5(v1.9)의 읽기 모델 8개 테이블을 SQLite 타입으로 옮긴 DDL(tenant_id 포함, 인덱스 포함) + 설계서 §5.1의 추가 테이블 8개(stream_meta, explanation, rulebook_chunk, sim_stub, answer_log, budget_counter, eval_run, eval_case_result). 상위 §5 컬럼명이 본 설계서 §5.1·§7이 참조하는 이름과 다르면 멈추고 docs/DECISIONS.md에 차이 목록을 적는다.
4. web: React 19 + Vite 8.1 + TypeScript, 빈 홈("Hello, 데모GA") + 고정 문구 푸터.
5. .github/workflows/deploy.yml: main 푸시 시 web build → wrangler deploy. 시크릿은 CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID만.
6. 아키텍처 테스트 뼈대(worker/test/arch.test.ts): worker/src/tools/** 에 INSERT|UPDATE|DELETE 문자열이 있으면 실패, worker/src/** 의 SQL 문자열에 tenant_id가 없으면 실패(화이트리스트 파일 목록 제공).
7. docs/limits-check.md: 설계서 §10의 각 URL을 다시 열어 수치·갱신일을 기록. Gemini AI Studio 한도는 사람이 캡처해야 하므로 "사람 작업" 체크박스로 남긴다. GitHub Actions 공개 저장소 무료 조건, Workers Static Assets 요청 미집계 여부를 공식 문서 URL과 함께 기입.

완료 기준: `pnpm -r test` 통과(projection-java 제외), `wrangler deploy` 후 *.workers.dev에서 홈과 /api/v1/health 응답, docs/limits-check.md와 docs/evidence/phase-0.md의 "사람 작업"이 Gemini 콘솔 캡처·GitHub Actions 조건·JDK 25 설치 3건뿐.
```

---

## Phase 1 — 데모 세계 생성기 + 불변식 게이트

```
설계서 §4.1(a), §4.2 G1~G3, 부록 B.3, 상위 설계서 §4.2 이벤트 카탈로그·§5 불변식·부록 B 데모 사양을 읽는다.

1. contracts/: 상위 설계서 contracts/events/v1/*.json을 복사(없으면 §4.2 표대로 작성). plan/v1/plan.schema.json 추가.
2. gen/world/plan.ts: 프롬프트 prompts/plan/v1.md로 LLM 구조화 출력 호출(gen/providers/ 경유, --stub이면 providers/vcr/plan.json 재생). 필수 케이스 15건은 코드가 플랜에 주입하고 LLM은 나머지만 채운다(경계 4건은 LLM 출력 뒤 — 그 날짜 계약이 있으면 태깅, 없으면 주입). 출력은 G1(ajv) 검증.
3. gen/world/expand.ts: 플랜 → 이벤트 스트림(JSONL, seq 단조 증가, eventId UUIDv7). 금액·한도·분급 스케줄은 gen/world/rules/(가상 요율표, 상위 설계서 부록 B 규칙)에서 결정론으로 계산. LLM 호출 없음. 같은 플랜 → 바이트 동일 스트림(해시 테스트).
4. projection-java: 상위 저장소 portal-projection을 subtree 또는 복사(§14.1-8은 "복사 + 해시 고정"으로 시작). CLI `replay <stream.jsonl>`가 인메모리 뷰를 만들고 §5 불변식 3개를 검사, 실패 시 exit 1과 위반 목록.
5. gen/verify/index.ts: G1 → G2(projection-java 호출) → G3(필수 케이스 존재) 순서. 통과 시 data/stream/<sha256>.jsonl 저장 + data/stream/<hash>.meta.json.
6. gen/load/d1.ts: 스트림을 D1 적재용 SQL로 변환(배치 INSERT, 트랜잭션), stream_meta.active 전환. `wrangler d1 execute --file`로 적용.

골든: 부록 A 데이터 전제(설계사 A-1001, 2026-08-01 체결, POL-2026-0001, 월납 150,000, 한도 1,800,000 …)가 스트림에 그대로 존재해야 한다(테스트가 A-1 정본 11건(seq 1~11)을 payload 필드 단위로 대조한다 — 설계서 v0.1.5 §4.1(a)).

완료 기준: `pnpm run world:plan --stub && pnpm run world:expand && pnpm run verify` 통과, 리플레이 2회 뷰 바이트 동일, D1 적재 후 `SELECT COUNT(*) FROM earnings_line` > 5000, 필수 케이스 15건 테스트 통과.
```

---

## Phase 2 — 읽기 API·화면 1차

```
설계서 §7(API), §8 화면 1~3, 상위 설계서 §6.2 상태 매핑·§6.3 한도 뷰 규칙·§7 응답 예시를 읽는다.

1. worker/src/api/session.ts: POST /api/v1/demo/session {demoAgent:1|2|3} → HMAC 서명 쿠키(SameSite=Lax, HttpOnly). 데모 설계사 3명은 stream_meta와 함께 적재된 config에서 읽는다.
2. worker/src/db/ScopedQuery.ts: tenant_id·agent_id를 생성자에서 받아 모든 SQL에 강제 바인딩하는 빌더. 이 빌더 밖의 D1 접근은 아키텍처 테스트 실패.
3. GET /api/v1/me, /me/earnings?from&to, /me/earnings/{ym}, /me/earnings/{ym}/lines, /me/earnings/lines/{calcId}, /me/limits, /me/limits/{ledgerId}. explanation 필드는 항상 null(Phase 3). 공통 필드 asOf·dataStatus·disclaimer. ETag=stream_hash.
4. DerivedNumbers.ts: 월 합산 검증(라인 Σ와 earnings_month 일치 확인), remaining, utilization. 이 파일 밖에서 금액에 사칙연산 금지(ESLint 커스텀 룰 또는 grep 테스트).
5. web 화면 1~3: 설계사 선택, 월별 명세(라인 목록·상세, 취소 짝 접기), 한도 현황(카드·소진 바·이력). 상단 칩 3개 중 "기준 데이터" 칩만 실제, 나머지는 자리만.
6. 테스트: 인가 매트릭스(타인 calcId → 404, 쿠키 없음 → 401), 상태 라벨(PROVISIONAL/ESTIMATED/CONFIRMED/PAID) 렌더, Playwright 3명 × 3화면.

완료 기준: Playwright 통과, 아키텍처 테스트 통과(ScopedQuery 외 D1 접근 0건), 응답 예시(설계서 §7 상위 구조)와 스키마 일치.
```

---

## Phase 3 — 그라운딩 검증기 + 설명 사전 생성

```
설계서 §6.1(검증기), §4.1(b), §4.2 G4~G6, 부록 B.4, §5.1 explanation 테이블을 읽는다.

1. packages/grounding/ (worker와 gen이 공유하는 workspace 패키지): GroundingVerifier.verify(text, contextNumbers, options) → {status, missing[]}. 한국어 수량 정규화(원·만·백만·%, 회차, YYYY년 M월, 202708), 근사어 포함, 조항 번호·순번 제외, 증권번호 뒷자리는 마스킹 값과 대조. 단위 테스트 40건 이상(설계서 §13 표의 예 포함).
2. gen/explain/: 라인(LINE)·한도(LIMIT)·월비교(MONTH_DIFF) 3종 컨텍스트 빌더 + prompts/explain_line/v1.md, explain_limit/v1.md, explain_month/v1.md. 구조화 출력 {text, citedFields, numbersUsed}. 캐시 키 streamHash+promptVersion+subject, 이미 있으면 호출 생략. --stub 지원.
3. G4(검증기)·G5(citedFields ⊆ 컨텍스트 키)·G6(금지어 목록 gen/verify/forbidden.json, 설계사 ID 패턴) 적용. 실패는 재생성 1회, 재실패는 grounding_status=FAIL로 저장하되 화면에는 노출하지 않는다.
4. D1 적재 후 전수 재검증 스크립트(§5.4 두 번째 불변식).
5. API: /me/earnings/lines/{calcId}·/me/limits/{ledgerId}·/me/earnings/{ym}/diff에 explanation 채움. 화면 2·3에 설명 블록·근거 보기(인용 필드 하이라이트)·검증 배지.

골든: 부록 A-01·A-02·A-03의 기대 핵심 사실이 해당 라인·한도 설명에 등장해야 한다(테스트는 stub 응답으로 고정).

완료 기준: 검증기 테스트 40건 통과, stub 기준 설명 생성·적재·표시, 전수 재검증 0건 위반, `grep -r "[0-9]" worker/src --include=*.ts`로 금액 상수 하드코딩 없음.
```

---

## Phase 4 — 사규집·RAG·툴·자유 질문

```
설계서 §4.1(c), §4.3, §4.4, §6.5, 부록 B.1·B.2, 부록 A 12건을 읽는다.

1. gen/rulebook/: prompts/rulebook/v1.md로 가상 사규 40조항 생성(각 조항 머리 "가상 규정 · 예시값"), 300~600토큰 청킹, rulebook_chunk 적재, bge-m3 임베딩(Workers AI REST), Vectorize 업서트(메타 article/visibility/version/chunk_id, visibility 메타데이터 인덱스). 요율표 조항 visibility=internal.
2. worker/src/tools/: get_statement(ym), get_limit(policyNo, 뒷자리 매칭), get_deferrals(from,to), get_policy_event_sim(policyNo, sim_stub 조회). 전부 ScopedQuery, agentId 서버 주입. 결과 직렬화 ≤ 1,200토큰(초과 시 라인 요약 30건 컷).
3. worker/src/llm/: providers.ts(Groq만, OpenAI 호환 fetch, 8초 타임아웃), promptRegistry.ts(prompts/**/v*.md frontmatter 파싱, PROMPT_VERSIONS env), answer.ts(§4.3 파이프라인: 임베딩 → Vectorize topK 6 filter visibility=agent → LLM 계획 → 툴 → LLM 답변 → G4·G5·G6 → answer_log). 툴 결과·청크는 <data>·<rules>로 감싼다.
4. POST /api/v1/me/ask, GET /api/v1/answers/{id}. 거부 사유 5종 고정 문구(§4.4). 아직 예산은 없음(Phase 5), 대신 개발용 하드 상한 20회/일을 env로.
5. web 화면 4(자유 질문)·7(답변 재현).
6. 테스트: visibility=internal 청크가 어떤 질의에도 반환되지 않음(Vectorize 로컬 바인딩), 타인 데이터 질문 → OTHER_AGENT, 스텁 없는 계약 시뮬 → NEEDS_ENGINE, A-12 오답 유도 → 답변에 200,000이 있으면 NOT_GROUNDED.

완료 기준: 부록 A 12건이 VCR 스텁으로 통과, 실호출 12건 수동 확인 캡처, answer_log 12행에 retrieved_chunks·tool_calls·grounding_status 기록.
```

---

## Phase 5 — 예산·폴백·캐시·봇 방지

```
설계서 §6.2, §6.4, §7 저하 모드·레이트 리밋, §9 남용 방지, §10.4를 읽는다.

1. worker/src/llm/budget.ts: budget_counter(D1) 원자적 증가, scope = global / ip:<일일 솔트 해시> / provider:<name>. 상한은 env BUDGET_GLOBAL=150, BUDGET_USER=10, BUDGET_GROQ=55, BUDGET_WORKERS_AI=80, BUDGET_OPENROUTER=15.
2. providers.ts 확장: groq → workers-ai(@cf/openai/gpt-oss-120b, AI 바인딩) → openrouter(openrouter/free). 429·5xx·타임아웃에서 다음으로, 최대 2개 공급자 시도. fallback_depth 기록.
3. AI Gateway: Groq·OpenRouter 호출을 게이트웨이 URL 경유, 캐시 키 헤더(정규화 질문+agentId+streamHash+promptVersion), TTL 24h. 캐시 히트는 예산 미차감.
4. 저하 모드: 소진 시 /ask → 429 {refused:true, reason:"BUDGET", retryAfterSeconds}. /me의 budget 필드로 남은 횟수 노출. 화면 상단 "오늘 남은 질문 n회" 칩, 입력창 비활성.
5. Turnstile: /ask에 토큰 검증(TURNSTILE_SECRET), 토큰 TTL 24h 쿠키.
6. GET /api/v1/budget + 화면 6.
7. 테스트: 공급자 스텁 429 주입 → depth 1·2, 동시 50요청에서 카운터 정확, 소진 후 설명 API 200·/ask 429, 캐시 히트 시 카운터 불변.

완료 기준: 테스트 통과, /budget에 공급자별 사용·폴백 분포 표시, 실호출로 Groq 429 1회 유도 후 Workers AI 폴백 기록 캡처.
```

---

## Phase 6 — 평가 하네스·프롬프트 버전 게이트

```
설계서 §13.1·§13.2, §6.3, 부록 A, §5.1 eval_run/eval_case_result를 읽는다.

1. evals/cases.jsonl: 60문항(라인 15, 한도 12, 분급 8, 규정 10, 거부 15; 오답 유도 8건 포함). 각 케이스 {id, demoAgent, question, expectedTools[], expectedFacts[], expectRefusal?, expectReason?}. 부록 A 12건을 그대로 포함, 나머지는 데모 설계사 2·3의 A-2·A-3 시나리오에서 파생.
2. evals/run.ts: /ask를 직접 호출하지 않고 worker의 answer() 함수를 임포트해 실행(런타임 동일). --stub 지원. 결과를 eval_run·eval_case_result에 적재(D1 REST 또는 wrangler).
3. evals/score.ts: 4축 결정론 채점(§13.1). 임계치는 evals/THRESHOLDS.md에서 읽는다.
4. .github/workflows/eval-on-prompt-change.yml: prompts/** 변경 PR에서 60문항 실호출(Groq) → 채점 → PR 코멘트(4축 표 + 직전 활성 버전 대비) → 임계치 미달 시 실패. 필수 체크로 등록 절차를 docs/evidence/phase-6.md에 기록.
5. GET /api/v1/evals, /evals/{runId} + 화면 5(추이 차트, 실패 우선 표).
6. 검증: 의도적으로 "숫자를 계산해서 알려줘"를 추가한 prompts/answer/v2.md로 PR을 열어 체크가 실패하는 캡처.

완료 기준: 첫 실런 결과가 /evals에 표시, 열화 PR 차단 캡처, THRESHOLDS.md에 초기값과 조정 이력.
```

---

## Phase 7 — 주간 배치·재구축·관측

```
설계서 §3.4-1, §4.1 캐시 키, §5.4, §6.4 첫 줄, §11 CI/CD를 읽는다.

1. .github/workflows/weekly-generate.yml(cron 매주 월 03:00 KST + workflow_dispatch): world:plan(실호출) → expand → verify → stream 커밋 → D1 재적재(비활성 슬롯 적재 → UPDATE 한 문장 전환, 설계서 §5.1·§5.4) → explain(변경 subject만) → rulebook(변경 시) → evals → deploy. 단계별 실패 시 이전 stream_meta.active 유지(전환 뒤 복구는 `load:d1 --rollback <hash>`, 설계서 §5.4).
2. gen/explain: streamHash가 바뀌면 영향 받은 subject만 재생성(라인 diff). 구 해시 설명은 active 스트림이 아니면 API에서 제외.
3. 재구축 명령 `pnpm run rebuild --stream <hash>`: D1 비우고 다시 적재 후 전수 재검증. 결정론 테스트(2회 적재 → 동일 체크섬).
4. Workers Logs에서 /ask 지연·폴백·거부 로그를 구조화(JSON) 출력, /budget에 7일 집계.

완료 기준: 배치 1회 완주 로그(각 단계 소요·LLM 호출 수), 새 해시 전환 후 화면 정상·구 설명 미노출, rebuild 결정론 테스트 통과.
```

---

## Phase 8 — README·데모 정리·E2E

```
설계서 부록 C, §8 전체, §1.4를 읽는다.

1. README.md: 부록 C 6항목 각각에 증거 링크(테스트 파일, docs/evidence 캡처, 공개 URL). "이 데모가 하지 않는 것" 3줄, 면책, 무료 한도 표(§10 요약)와 확인일.
2. 화면 1 데모 설계사 카드 3장(대표 케이스 설명), 예시 질문 칩 6개(golden에서 추출).
3. Playwright 전 화면 7개 × 데모 설계사 3명, 저하 모드 시나리오(예산 0으로 env 설정).
4. 번들 상한 CI(web dist gzip ≤ 250KB), Lighthouse 모바일 ≥ 80 캡처.
5. docs/evidence/phase-8.md에 최종 URL, 캡처, 총 LLM 호출 수·비용 0원 증빙(Cloudflare·Groq 대시보드).

완료 기준: 새 브라우저에서 URL만으로 7개 화면 전부 데이터 표시, E2E 통과, README의 모든 증거 링크 유효.
```
