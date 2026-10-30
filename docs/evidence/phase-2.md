# Phase 2 — 읽기 API·화면 1차 증거

- 수행일: 2026-10-30
- 기준 문서: 설계서 v0.1.12 §4.1(a)·§5.1·§5.4·§7·§8, PHASES.md Phase 2, 상위 설계서 v1.9(`126d848`) §6.2·§6.3·§7·§8, 상위 계약 `portal-api.openapi.yaml` 1.2.0
- 도구 버전: node 25.5.0(CI 24), pnpm 10.28.2, wrangler 4.153.0, Hono 4.13.14, vitest 4.1.12, @playwright/test 1.64.1(Chromium), @cfworker/json-schema 4.1.1, yaml 2.9.1, JDK 25.0.5
- 상태: **완료 기준 셋 모두 로컬에서 통과. 원격 반영(마이그레이션 0003·demo_agents 적재·시크릿 2개)은 운영자 확인 대기** — 아래 "사람 작업"

## 완료 기준 대조

| # | 완료 기준(PHASES.md 원문) | 결과 | 증거 |
|---|---|---|---|
| 1 | Playwright 통과 | 통과(로컬) — 5건: 데모 설계사 3명 × 화면 1~3(+라인·한도 상세), A-1 원장 타임라인, 세션 없음 → 선택 화면 | `logs/phase-2-playwright.log`, `captures/phase-2-*.png` |
| 2 | 아키텍처 테스트 통과(ScopedQuery 외 D1 접근 0건) | 통과 — D1 호출은 `src/db/ScopedQuery.ts`에만, 슬롯 접미 리터럴 0, tenant_id 없는 SQL 0, gen import 0, 금액 사칙연산은 `DerivedNumbers.ts`에만(worker/src·web/src 스캔) | `logs/phase-2-pnpm-r-test.log`(worker `test/arch.test.ts`) |
| 3 | 응답 예시(설계서 §7 상위 구조)와 스키마 일치 | 통과 — 모든 200 응답을 상위 계약 사본 + `copilot-overlay.json`(설계서 v0.1.12 §7)으로 검증. 시험 세계(`test/api.test.ts`) + 로컬 실데이터 3명 698응답 0 오류 | `logs/phase-2-smoke-contract.log` |

## 항목별 산출물

| 항목 | 산출물 |
|---|---|
| 1 세션 | `worker/src/api/session.ts` — `POST /api/v1/demo/session`(HMAC 서명 쿠키 `HttpOnly; Secure; SameSite=Lax`, `SESSION_SECRET`), 요청마다 활성 스트림 `demo_agents` 대조, 공개 `GET /api/v1/demo/agents`. 데모 설계사 config = `demo_agents` 표(stream_meta와 함께 적재) |
| 2 ScopedQuery | (`3a36d2e`) + IN·BETWEEN·IS NULL·DISTINCT·OFFSET·`count()`, `policy_limit_history`는 소유 원장 부분 질의, `demoAgents()`·`demoAgent()`. `tenantLineCount` 제거 — `/health`는 `stream_meta.line_count`만(규약 3 예외 해소) |
| 3 API | `worker/src/api/me.ts` — `/me`, `/me/earnings?from&to`, `/{ym}`, `/{ym}/lines`, `/lines/{calcId}`, `/limits`, `/limits/{ledgerId}`. `explanation: null`, `asOf {streamHash, generatedAt, demoNo}`, `dataStatus`, `disclaimer`, ETag `W/"<streamHash>.<demoNo>"` |
| 4 DerivedNumbers | `worker/src/domain/DerivedNumbers.ts` — 월 합산 검증(불일치 → `monthDataStatus: DRIFT`)·byType·remaining·utilization·stage. 그 밖의 금액 사칙연산 금지는 grep 시험(`moneyArithmetic`) |
| 5 화면 1~3 | `web/src/screens/{SelectAgent,Statement,LineDetail,Limits,Shell}.tsx`, `labels.ts`(상위 §6.2 라벨·세후 16칸), 칩 3개 중 "기준 데이터 MM-DD 생성 · 데모 설계사 n"만 실제 |
| 6 시험 | 인가 매트릭스·거부 바이트·캐시(`worker/test/api.test.ts`), 상태 라벨 렌더(`web/test/labels.test.tsx`), Playwright(`web/e2e/screens.e2e.ts`) |
| 데모 설계사 | G3 `DEMO_AGENTS`(13항목) → `meta.json demoAgents` → `load:d1`이 `demo_agents`에. 규칙 결과 = 운영자 결정(A-1001·A-1002·A-1003) |

## 실행 명령과 출력

### gen verify(G3 13항목, 해시 그대로)
```bash
$ cd gen && pnpm run world:plan --stub && pnpm run world:expand && pnpm run verify
```
```
stream e2e435e7bd59bdf96837de92b8c0d466953f6bcb4ab20a5aee94669e84f5f82f (9439건)
G1 스키마      PASS  invalid 0/9439
G2 리플레이    PASS  exit 0  views afb2bb92… (2회차 동일)
G3 필수 케이스 PASS
  …(12항목 PASS)
  PASS  DEMO_AGENTS            1 A-1001(POL-2026-0001 1 100) · 2 A-1002(6734 s-POL-2027-0003-1 15 4) · 3 A-1003(3041 l-POL-2026-03013 r-A-1003-1 1341 1561)
verify: PASS
```
`data/stream/<hash>.meta.json`은 `demoAgents`만 늘었다(`generatedAt` 유지 — 같은 스트림 재검증은 처음 시각을 둔다). 전체: `logs/phase-2-verify.log`

### 로컬 D1: 0003 적용 + demo_agents 채우기
```bash
$ cd worker && pnpm wrangler d1 migrations apply copilot --local     # 0003_demo_agents.sql ✅, line_count 백필 5200
$ cd gen && pnpm run load:d1 -- --local
```
```
이미 활성: e2e435e7… (slot a) — 슬롯 표는 그대로, demo_agents만 확인
demo_agents e2e435e7bd59… 3행 넣음: 1=A-1001 2=A-1002 3=A-1003
```
전체: `logs/phase-2-load-local.log`

### 실데이터 계약 검증(로컬 wrangler dev)
```bash
$ cd worker && pnpm wrangler dev --port 8787 --local &   node scripts/smoke-contract.mjs
```
```
demo 1 A-1001: months 25 (202603..202806) lines 103 ledgers 5
demo 2 A-1002: months 31 (202507..202806) lines 155 ledgers 8
demo 3 A-1003: months 35 (202507..202806) lines 224 ledgers 8
validated {"DemoAgentsResponse":1,"MeResponse":3,"EarningsResponse":3,"MonthResponse":91,"LinesResponse":91,"LineDetailResponse":482,"LimitsResponse":3,"LimitDetailResponse":21} drift 0 stages {"OK":19,"FULL":1,"WARN":1}
errors 0 []
```

### 전체 시험
```bash
$ pnpm lint && pnpm -r test && (cd projection-java && ./gradlew --no-daemon test)
```
```
web test:       Tests  30 passed (30)
gen test:       Tests  129 passed (129)
worker test:    Tests  168 passed (168)
projection-java: exit 0
```
전체: `logs/phase-2-pnpm-r-test.log`, `logs/phase-2-projection-java-test.log`

### Playwright
```bash
$ cd web && pnpm run e2e        # vite build → wrangler dev :8788(로컬 D1) → playwright test
```
```
  ✓  1 데모 설계사 1: 선택 → 명세 → 라인 상세 → 한도 → 한도 상세
  ✓  2 데모 설계사 2: …
  ✓  3 데모 설계사 3: …
  ✓  4 데모 1: A-1 원장 타임라인이 누적 1,800,000원(한도 100%)에 닿는다 — 카드는 해약 뒤 현재 값
  ✓  5 세션 없이 설계사 화면에 오면 설계사 선택으로(401)
  5 passed (3.6s)
```
캡처: `captures/phase-2-screen1-select.png`, `phase-2-demo{1,2,3}-screen2-statement.png`, `phase-2-demo{1,2,3}-screen3-limits.png`, `phase-2-demo1-a1-ledger.png`

## 결정·편차

- 설계서 먼저: v0.1.11(`85b8b32` — demo_agents·line_count·G3 13항목·§5.4 두 문장·asOf.demoNo·카드 3 문구·ci.yml, 마이그레이션 0003 포함), v0.1.12(`c77b698` — 읽기 API 구현 규약·계약 사본·덧씌우기).
- ETag: PHASES는 "ETag=stream_hash"지만 `W/"<streamHash>.<demoNo>"` + `Vary: Cookie`로 했다 — 같은 브라우저에서 설계사를 바꾸면 해시만으로는 남의 본문이 304로 재사용된다(설계서 v0.1.12 §7).
- `/me`의 `budget`·`promptVersions`는 그 기능의 Phase(4·3)에서 — 계약상 선택 필드라 지금은 생략. `/me`에 `months {from, to}`를 덧붙였다(화면 월 범위).
- 응답 검증기: workerd는 문자열 코드 생성을 막아 Ajv를 쓸 수 없어 `@cfworker/json-schema`(4.1.3은 오늘 게시돼 4.1.1로 고정).
- Playwright는 CI에 넣지 않았다 — 로컬 D1에 적재된 스트림이 필요하다(CI는 `pnpm -r test`의 API 시험이 같은 경로를 시험 세계로 본다).
- `worker/.dev.vars`에 `SESSION_SECRET`·`POLICY_KEY_SECRET` 로컬 값을 무작위로 추가했다(커밋 안 함). `worker/.dev.vars.example`을 새로 커밋(키 이름만 — 지금까지 저장소에 없었다).

## 사람 작업

- [ ] **원격 반영(푸시 전에)** — `deploy.yml`은 마이그레이션을 돌리지 않으므로, 새 Worker가 배포되기 전에 아래가 먼저 있어야 한다(없으면 `/health`·`/demo/*`·`/me/*`가 실패): — 담당: 운영자(확인 후 실행 지시 또는 직접)
  1. `cd worker && pnpm wrangler d1 migrations apply copilot --remote` (0003: 열·표 추가 + line_count 백필, 추가만)
  2. `cd gen && pnpm run load:d1 -- --remote` (이미 활성 경로 — demo_agents 3행만, 약 9 rows written)
  3. `cd worker && pnpm wrangler secret put SESSION_SECRET` · `pnpm wrangler secret put POLICY_KEY_SECRET` (서로 다른 무작위 값)
- [ ] 원격 D1 rows_written 실측(Phase 1에서 이월).

## 남은 이슈

1. **데모 1 카드 문구와 현재 원장 값**: A-1001의 A-1 원장(`1`)은 2026-08에 누적 1,800,000/1,800,000(100%)에 닿지만, 2027-02 해약 환수 뒤 끝 상태는 1,080,000(60.0%, 단계 OK)이다. 읽기 모델은 2028-06까지 다 돈 끝 상태라 한도 카드에는 100%가 안 보이고 타임라인에만 보인다. 카드 문구 "한도 100% 소진 계약 보유"를 유지할지, 선정 규칙을 "끝 상태 FULL"로 바꿀지(그 경우 A-1003의 `l-POL-2026-0004` 105.0% FULL이 유일) 결정이 필요하다.
2. **ID 안의 증권번호**: gen 세계가 원장·라인·스케줄 ID를 `l-POL-…`·`c-POL-…-n`·`s-POL-…-n`으로 만들어, `policyNo` 필드는 없어도 ID 값과 화면 URL(`/me/limits/l-POL-2026-0004`)에 가상 증권번호가 들어간다(상위 §7·§8 "증권번호는 응답·경로에 없다"의 취지와 어긋남). 가상 데이터라 노출 위험은 없지만, 고치려면 gen ID 체계를 바꿔야 하고 스트림 해시가 바뀐다(A-1 예약 ID `1`·`2`·`6`은 영향 없음). 시험은 "값이 증권번호 그대로인 필드 없음"으로 좁혀 두었다.
3. 소진 바의 백분율 글자가 90% 근처에서 채움 위에 겹친다(가독성 경미).
