# Phase 1 — 데모 세계 생성기 + 불변식 게이트 증거

- 수행일: 2026-10-27 ~ 2026-10-30
- 기준 문서: 설계서 v0.1.9(수행 중 v0.1.4 → v0.1.9로 올림 — 아래 "설계서·지시문 변경"), PHASES.md Phase 1, 상위 설계서 v1.9 §4.2·§5·부록 A-1·부록 B
- 도구 버전: node v25.5.0(로컬; CI는 `.nvmrc` 24), pnpm 10.28.2, wrangler 4.153.0, JDK Temurin 25.0.5, Gradle 9.3.0
- 공개 URL: https://ga-commission-copilot.ga-copilot-demo.workers.dev
- 활성 스트림: `e2e435e7bd59bdf96837de92b8c0d466953f6bcb4ab20a5aee94669e84f5f82f`(9,439 이벤트, `data/stream/`), 원격 D1 슬롯 `a`
- 상태: **수용 대기**

## 완료 기준 대조

| # | 완료 기준(PHASES.md 원문) | 결과 | 증거 |
|---|---|---|---|
| 1 | `pnpm run world:plan --stub && pnpm run world:expand && pnpm run verify` 통과 | 통과 — G1 9,439/9,439, G2 exit 0, G3 12/12 PASS | §5, `logs/phase-1-verify.log` |
| 2 | 리플레이 2회 뷰 바이트 동일 | 통과 — CLI 안 2회(새 저장소) 뷰 해시 `afb2bb92…` 동일, 별도 프로세스 재실행도 같은 스트림·뷰 해시 | §4·§5, `logs/phase-1-verify.log`(재실행 절), `logs/phase-1-replay.log`(별도 프로세스 2회 `diff -r` — 경계 4건 이전 스트림 `7ec81608…` 기준) |
| 3 | D1 적재 후 `SELECT COUNT(*) FROM earnings_line` > 5000 | 통과 — 로컬·원격 모두 `earnings_line_a` 5,200(설계서 v0.1.8 A/B 슬롯이라 표 이름에 슬롯 접미). 외부 `/api/v1/health` `earningsLines: 5200` | §6, `logs/phase-1-load-local.log`, `logs/phase-1-load-remote.log` |
| 4 | 필수 케이스 15건 테스트 통과(설계서 v0.1.7 — 원문 12건에서 바뀜) | 통과 — 플랜 강제 케이스 15건(`gen/test/plan.test.ts`), 스트림 G3 12항목 PASS(`gen/test/verify.test.ts`, verify 출력) | §3·§5 |
| 골든 | 부록 A 데이터 전제(A-1001, 2026-08-01, POL-2026-0001, 월납 150,000, 한도 1,800,000 …)가 스트림에 그대로 | 통과 — A-1 정본 11건이 payload 필드 단위로 동등·순서 일치(eventId·occurredAt·전역 seq 오프셋 제외, basisSeq는 대응 seq로) | `gen/test/expand.test.ts`, G3 `A1_GOLDEN` |

## 지시 항목별 산출물

| # | 지시 | 산출물 | 커밋 |
|---|---|---|---|
| 1 | contracts | `contracts/events/v1/**`(상위 `126d848` 복사, `UPSTREAM`·`CHECKSUMS.upstream`), `contracts/shared/ga-disclosure/…`, `contracts/plan/v1/plan.schema.json`(+ `forcedCase` 15종), `plan-llm.schema.json`(LLM 출력 전용) | f17a92f 외 |
| 2 | 플랜 생성 | `gen/world/plan.ts`, `prompts/plan/v1.md`, `prompts/plan_repair/v1.md`, `gen/providers/{groq,cassette,budget,env,prompt}.ts`, **녹화** `gen/providers/vcr/plan.json`(Groq `openai/gpt-oss-120b` 실호출 30건), 수기 픽스처 `gen/providers/fixtures/plan.fixture.json`(LLM 출력 아님 — vcr 없을 때만 폴백, 현재 미사용) | cbe571d |
| 3 | 결정론 전개 | `gen/world/expand.ts`, `gen/world/rules/`(가상 요율표), `gen/world/forced.ts`, `gen/world/golden.ts` | cbe571d, 6c2ba19, e02d464 |
| 4 | projection-java | `projection-java/upstream/`(상위 portal-domain·portal-projection 복사 + CHECKSUMS 181개), `ReplayCli`(`replay <stream.jsonl> [--views <dir>]`) | ab16db3 |
| 5 | 검증 게이트 | `gen/verify/{index,g2,g3}.ts`, `data/stream/<sha256>.jsonl` + `.meta.json` | df7ea00, 6c2ba19 |
| 6 | D1 적재 | `worker/migrations/0002_ab_slots.sql`, `gen/load/{d1,sql}.ts`, `worker/src/db/active-stream.ts`, `/api/v1/health` 확장 | 295f2c1 외 |
| 종료 | CI | `.github/workflows/ci.yml` — push·PR에서 `pnpm -r test` + `./gradlew test`(Temurin 25). deploy.yml과 분리 | 이 커밋 |

## 1. 테스트

```
$ NO_COLOR=1 pnpm -r test                      (logs/phase-1-pnpm-r-test.log)
web test:  Tests  2 passed (2)
gen test:  Test Files  5 passed (5)   Tests  115 passed (115)
worker test:  Test Files  3 passed (3)   Tests  47 passed (47)
exit=0

$ cd projection-java && ./gradlew test         (logs/phase-1-projection-java-test.log)
61 passed — 상위 복사 시험 45(FlagProjector 10, GoldenStreams 8, ProjectionGolden 10, ProjectionInvariant 15, ProjectionScope 1, RecordingProjector 1)
          + 새 시험 16(ReplayTest 15, UpstreamPinTest 1)
```

타입 검사: `gen`·`worker` `tsc --noEmit` 오류 0.

### 제외한 상위 시험과 이유

`projection-java/upstream/`에는 상위 `portal-projection/src/test/java` 가운데 6개 클래스만 가져왔다. 아래는 의존성 때문에 뺐다.

| 상위 시험 | 필요한 의존성 | 비고 |
|---|---|---|
| `contracts/EventSchemaTest` | `com.networknt:json-schema-validator`, `jackson-dataformat-yaml` | 계약 스키마 검사 |
| `contracts/StatementSamplesTest` | `json-schema-validator`, `jackson-dataformat-yaml` | 엔진 명세 샘플 스키마 검사 |
| `contracts/ContractYamlParsersTest` | `snakeyaml`, `jackson-dataformat-yaml` | 계약 YAML 1.1·1.2 해석 대조 |
| `notify/NotificationRulesTest` | `com.ga.platform:platform-core` **시험 픽스처**(`SeededCases`, GitHub Packages — PAT 필요) | 알림 파생 규칙 |
| `notify/NotificationStreamsTest` | 상위 `web/e2e/streams/` 손 스트림 | 알림 파생 E2E |

**스키마 검사는 gen G1이 담당한다** — `gen/world/schemas.ts`가 같은 `contracts/events/v1/**`(상위 `126d848` 복사본)를 Ajv 2020으로 읽고, `pnpm run verify`의 G1이 스트림 전 이벤트를 봉투·payload 스키마로 검사한다(§5). projection-java(G2)는 불변식·결정론만 본다.

## 2. 플랜 생성(항목 2) — 녹화와 수기 픽스처

- 녹화 1회(2026-10-27): 30명 전원 성공, 15명은 의미 검사 위반 뒤 `plan_repair/v1` 재질문 1회로 통과. 토큰 66,547, dev 예산 카운터(D1 `budget_counter` scope=dev) 48 사용. 로그 `logs/phase-1-plan-record.log`.
- 실패한 앞 시도 2건도 남겼다: 예산 예약 단계 Cloudflare 7403(Groq 호출 0, `…attempt1-7403.log`), A-1002가 temperature 0에서 같은 위반을 3번 되풀이(`…attempt2-A1002-reject.log` → 재질문 프롬프트 추가의 근거).
- `--stub`은 `vcr/plan.json`을 재생한다. 수기 픽스처 폴백 경고는 나오지 않는다(`source=vcr`, `liveCalls 0` — `data/stream/*.meta.json`).

## 3. 강제 케이스 15건(설계서 v0.1.7 §4.1(a))

필수 케이스 11건 + 경계 4건. 경계는 LLM 출력 뒤에 정한다 — 그 날짜 계약이 있으면 태깅, 없으면 주입(`gen/out/plan.meta.json` `boundaries`).

| 경계 | 날짜 | 계약 | 방법 |
|---|---|---|---|
| `BOUNDARY_LIMIT_BEFORE` | 2026-06-30 | `POL-2026-0012` | 필수 케이스 계약에 태깅 |
| `BOUNDARY_LIMIT_AFTER` | 2026-07-01 | `POL-2026-06013` | LLM 계약 태깅 |
| `BOUNDARY_DEFERRAL_BEFORE` | 2026-12-31 | `POL-2026-03016` | LLM 계약 태깅 |
| `BOUNDARY_DEFERRAL_AFTER` | 2027-01-01 | `POL-2027-0016`(A-1014) | 주입(녹화 플랜에 그 날짜 계약 0건) |

06-30 경계 중복(`BOUNDARY_PRE_LIMIT`)을 합칠 때 태깅만 바뀌어 스트림 해시 `e2e435e7…`가 바뀌지 않았음을 확인했다(e02d464).

## 4. G2 리플레이 CLI(항목 4)

```
$ projection-java replay <stream.jsonl> [--views <dir>]
stdout: 요약 JSON 한 줄 {ok, streamSha256, events, viewsSha256, viewsSha256Second, tables, violationCount, violations[≤200]}
exit 0 통과 · 1 불변식 위반(stderr에 목록) · 2 사용법·입력 오류
```

- 검사: 상위 `ViewProjector`가 거부하는 것(마감월 변경 `CLOSED_MONTH`, 누적 사슬, 양수 전기 뒤 한도 초과, 음수 누적, 순번 갭) + 확정·지급 합계 ≠ Σ 라인(`SUM_MISMATCH`) + seq 갭 + 끝 상태 재대조(월 합산, 감액 재산정이 아닌 누적 > 한도, 확정 뒤 그 달 라인).
- 생성 스트림에서 한 줄만 바꾼 변이 3종은 모두 exit 1(`logs/phase-1-replay.log`): 확정 gross +1원 → `SUM_MISMATCH`, 전기 누적 한도+1 → `OVER_LIMIT`(+ 연쇄 `STATE_MISMATCH` 1), 지급 끝난 달에 라인 추가 → `CLOSED_MONTH`.

## 5. 검증 게이트(항목 5)

```
$ pnpm run world:plan --stub && pnpm run world:expand && pnpm run verify     (logs/phase-1-verify.log)
plan: 426건(강제 15 — 경계 2026-06-30 tagged, 2026-07-01 tagged, 2026-12-31 tagged, 2027-01-01 injected) source=vcr
stream: 9439건 sha256=e2e435e7bd59bdf96837de92b8c0d466953f6bcb4ab20a5aee94669e84f5f82f
G1 스키마      PASS  invalid 0/9439
G2 리플레이    PASS  exit 0  views afb2bb9271e698943193c8ca38098aed1baf5bacd68daee322c1f92d9e3b1b1e (2회차 동일)
G3 필수 케이스 PASS
verify: PASS
→ data/stream/e2e435e7….jsonl + .meta.json
```

G2는 CLI 종료 코드를 먼저 본다 — 0이 아니면 요약 JSON이 없거나 깨져도, 또는 `ok:true`라고 적혀 있어도 실패. exit 0이면 요약의 ok·2회 뷰 해시·스트림 해시·이벤트 수를 다시 대조한다(가짜 실행기 시험 `gen/test/verify.test.ts`).

G3 항목별 결과(상위 부록 B 8종 — 경계 넷은 4항목 — + A-1 동등, 12항목):

| 항목 | 결과 | 근거 |
|---|---|---|
| LIMIT_80_95_100 | PASS | 80%대 2(`l-POL-2026-10009`) · 95%대 1(`l-POL-2026-0006`) · 100% 2(A-1 원장 `1`) |
| CUT_AND_DEFER | PASS | CUT 1(seq 2076) · DEFER_AFTER_FY 1(seq 1308) |
| REBASE | PASS | LimitLedgerRebased 13 |
| DEFERRAL_HELD | PASS | HELD 5(`s-POL-2027-0003-1` 외) |
| RECEIVABLE_CARRIED | PASS | OPEN 30, 모두 뒤에 상계·종결 |
| REVERSAL_PAIR | PASS | `c-POL-2026-0010-2 → c-POL-2026-0010-1` |
| ADJUSTMENT_AFTER_CLOSE | PASS | `a-POL-2026-0011-1 → c-POL-2026-0011-1` |
| BOUNDARY_LIMIT_BEFORE | PASS | 2026-06-30 체결 19건 전부 원장 없음 |
| BOUNDARY_LIMIT_AFTER | PASS | 2026-07-01 체결 5건 전부 원장 있음 |
| BOUNDARY_DEFERRAL_BEFORE | PASS | 2026-12-31 체결 9건 전부 커브 스케줄 없음 |
| BOUNDARY_DEFERRAL_AFTER | PASS | 2027-01-01 체결 1건 커브 스케줄 있음 |
| A1_GOLDEN | PASS | 11건 동등·순서 일치 |

1회차 verify는 `BOUNDARY_4` FAIL(2027-01-01 체결 0건)로 data/stream을 쓰지 않았다(`logs/phase-1-verify-attempt1-boundary-fail.log`) → DECISIONS (A) 결정 뒤 경계 강제 케이스 추가.

`data/stream/<hash>.meta.json`: `streamSha256`, `generatedAt`, `eventCount`, `plan.{prompt plan/v1, repairPrompt plan_repair/v1, source vcr, mode stub, liveCalls 0, sha256}`, `replay.{projection ga-agent-portal@126d848, viewsSha256, tables}`, `gates`, `requiredCases`(12항목).

## 6. D1 적재(항목 6)

### 방식(설계서 v0.1.8·v0.1.9 §5.1·§5.4)

`wrangler d1 execute --file`·`--command`의 다중 문장 트랜잭션은 D1 공식 문서에 없다(D1 문서가 보장하는 것은 Worker `batch()`와 문장 단위 커밋). 그래서:

- 읽기 모델 8표를 A/B 슬롯(`<표>_a`·`<표>_b`, 인덱스 `<원래이름>_<slot>`)으로 두고, 활성 슬롯은 Worker 조회 계층이 `stream_meta`(요청마다 1행)로 고른다. 뷰는 두지 않는다.
- 적재기는 비어 있는 비활성 슬롯에만 쓴다(읽는 쪽에 보이지 않는다) → 슬롯 표를 SQL로 재검사 → `UPDATE stream_meta SET active = CASE WHEN stream_hash = ? THEN 1 ELSE 0 END` **한 문장**으로 전환 → `SELECT COUNT(*) FROM stream_meta WHERE active = 1` = 1 확인.
- `ux_stream_meta_active`(active=1 부분 유일 인덱스)가 2행을 막는다. 이 인덱스는 UPDATE가 행을 바꿀 때마다 검사되므로 전환 대상은 활성 행보다 나중에 들어간 행이어야 한다 — 적재기가 rowid 순서를 먼저 확인하고, 반대 방향 전환은 문장 전체가 실패해 아무것도 바뀌지 않는다(`worker/test/schema.test.ts`).
- 이전 슬롯 비우기는 `load:d1 -- --purge-inactive` 별도 단계(§14.1-10: Phase 7 배치에서는 다음 날 00:00 UTC 이후).

### 쓰기 예산(운영자 지시 (c))

| 표 | 행 | 인덱스(PK 자동 + UNIQUE + 보조) | rows written 추정 |
|---|---:|---:|---:|
| agent_profile | 30 | 1 | 60 |
| earnings_line | 5,200 | 3 | 20,800 |
| earnings_month | 962 | 1 | 1,924 |
| policy_limit | 182 | 2 | 546 |
| policy_limit_history | 215 | 1 | 430 |
| deferral_item | 210 | 2 | 630 |
| clawback_item | 30 | 1 | 60 |
| policy_flag | 181 | 1 | 362 |
| stream_meta | 1 | 3 | 4 |
| **합계** | **7,011** | | **24,816**(무료 100,000/일의 25%) |

적재기는 80,000을 넘으면 멈춘다. 원격 실측: `wrangler d1 info copilot`의 `rows_written_24h`가 적재 직후(2026-10-30 20:16 KST)에도 84로 적재분이 아직 집계되지 않았다 — **재확인 필요**(아래 사람 작업).

### (b) 로컬 먼저 적재·SQL 재검사(`logs/phase-1-load-local.log`)

```
$ pnpm --dir worker exec wrangler d1 migrations apply copilot --local      0001·0002 ✅
$ pnpm run load:d1 -- --local
⑤ 재검사 slot a: {"agent_profile":30,"earnings_line":5200,"earnings_month":962,"policy_limit":182,"policy_limit_history":215,"deferral_item":210,"clawback_item":30,"policy_flag":181}
   월 합산 불변식: 월 행 962, 라인 있는 (설계사, 월) 962, 합계 불일치 0, 월 행 없는 라인 묶음 0
⑦ 전환 완료: active=1 1행, e2e435e7… slot a
$ (wrangler dev --local) curl /api/v1/health
{"ok":true,"d1":1,"streamHash":"e2e435e7bd59bdf96837de92b8c0d466953f6bcb4ab20a5aee94669e84f5f82f","earningsLines":5200}
```

- 표별 COUNT = projection-java 뷰 행 수(적재 전 `replay --views`로 다시 만들고 meta 뷰 해시와 대조).
- 월 합산 불변식 SQL(`gen/load/sql.ts` `monthInvariantSql`): 월 행의 gross·clawback_offset·adjustment ≠ 그 달 라인 합 → 0건, 라인은 있는데 월 행이 없는 (설계사, 월) → 0건.
- 1회차는 표별 COUNT를 `UNION ALL`로 묶다가 D1의 compound SELECT 항 수 제한으로 쓰기 전에 실패 → 스칼라 서브쿼리로 바꿈.

### 원격 적재(`logs/phase-1-load-remote.log`)

1. 적용 전 확인: 0002가 DROP하는 9표(0001 읽기 모델 8 + stream_meta) 행 수 모두 0.
2. `wrangler d1 migrations apply copilot --remote` → 0002 ✅(35 commands).
3. `load:d1 -- --remote` 1회차: ④ `--file` 적용은 끝났으나 wrangler가 원격 `--file` 출력에서 JSON 앞에 업로드 진행 문구를 찍어 파싱에서 멈춤 — 슬롯 a 적재·`stream_meta` active=0, **전환 전**이라 읽는 쪽에는 보이지 않았다.
4. 파서를 고치고 "같은 해시가 대상 슬롯에 비활성으로 있고 표별 행 수가 뷰와 같으면 ⑤부터"를 넣어 2회차로 이어감(다시 넣지 않음 — 쓰기 두 배 방지): ⑤ 재검사 로컬과 같은 값·불일치 0 → ⑥ 전환 → ⑦ active=1 1행.
5. `wrangler deploy` → Version `6b21fbad-28f3-4d40-8bee-c6d26a2ca5b1`.

### (d) 외부 확인

```
$ curl https://ga-commission-copilot.ga-copilot-demo.workers.dev/api/v1/health      (2026-10-30 20:15 KST)
{"ok":true,"d1":1,"streamHash":"e2e435e7bd59bdf96837de92b8c0d466953f6bcb4ab20a5aee94669e84f5f82f","earningsLines":5200}
```

`earningsLines`는 활성 슬롯 `earnings_line_<slot>`의 `COUNT(*) WHERE tenant_id = 'T1'`이며 isolate 안에서 `stream_hash`를 키로 한 번만 센다(요청마다 5천여 행을 읽지 않는다). 아키텍처 테스트는 화이트리스트 파일이어도 테넌트 표(슬롯 접미 `_a`·`_b`·`_${slot}` 포함) SQL에 `tenant_id`를 요구하도록 넓혔다.

## 설계서·지시문 변경(Phase 1 중)

| 버전 | 내용 | 승인 |
|---|---|---|
| v0.1.4·v0.1.5 | A-1 골든 수치를 상위 v1.9 정본(150,000)으로, 후속 정리 | DECISIONS (B) |
| v0.1.6 | projection-java "복사 + CHECKSUMS 고정"(§14.1-8), 강제 케이스 16, limits-check 2·3·4·6·8 | 사전 승인 |
| v0.1.7 | 강제 케이스 15(06-30 경계 하나로), G3 12항목 | 운영자 지시 |
| v0.1.8 | 읽기 모델 A/B 슬롯, stream_meta.slot·부분 유일 인덱스, §14.1-10 | 운영자 선택(슬롯 방식) |
| v0.1.9 | §5.4 전환 문장의 행 순서 제약 | 구현 중 발견(시험으로 확인) |
| PHASES.md | Phase 1 골든 문구(150,000), 강제 케이스 수, Phase 3 A-12 값 200,000, 머리말 "수치는 설계서 부록 A가 정본" | 운영자 허용(수치 불일치 즉시 수정) |

미결정·결정 기록: `docs/DECISIONS.md`(A-1 골든 출처, §14.1-8, G3 경계 넷).

## 알려 둘 것

- **CLAUDE.md 규약 2와의 관계**: `gen/world/rules/`·`expand.ts`는 요율 곱하기·환수액·세액을 계산한다. PHASES 항목 3이 지시한 데모 세계의 "엔진 대역"(오프라인 생성기)이며 worker에는 들어가지 않는다. worker·적재기는 합계만 쓴다.
- 분급 커브는 상위 엔진 샘플(연 단위 40/20/20/20%)을 따른다 — 상위 A-2 본문의 "48개월 예정" 표현과 다르다.
- `logs/phase-1-replay.log`와 `logs/phase-1-plan-expand-stub.log`는 경계 4건을 넣기 전 스트림(`7ec81608…`, 9,429건)으로 찍었다. 최종 스트림의 G2는 `logs/phase-1-verify.log`.
- 첫 적재 전에는 `stream_meta`가 비어 active=1이 0행이다(§5.4 "첫 적재 뒤"). 지금은 1행.

## 사람 작업

- [ ] `git push` — 로컬 main이 origin보다 앞서 있다. 푸시 뒤 `ci.yml` 첫 실행 결과(특히 ubuntu에서 `./gradlew test`) 확인.
- [ ] 원격 D1 실측 rows written: 2026-10-30 20:13 KST 적재분이 `wrangler d1 info copilot`의 `rows_written_24h`(또는 대시보드)에 반영된 뒤 값을 이 문서에 적는다(추정 24,816).
