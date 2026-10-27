# Phase 0 — 골격·한도 재확인 증거

- 수행일: 2026-10-27
- 기준 문서: 설계서 v0.1.1 §3.3·§5.1·§10·§11(수행 시점) → 수용 후 v0.1.2, PHASES.md Phase 0, 상위 설계서 v1.9 §5
- 도구 버전: node v25.5.0(로컬; CI는 `.nvmrc` 24), pnpm 10.28.2, wrangler 4.153.0, Gradle 9.3.0, 로컬 JDK Corretto 21.0.9
- 공개 URL: https://ga-commission-copilot.ga-copilot-demo.workers.dev
- 상태: **수용됨**(2026-10-27, 운영자 결정 4건 — 아래 "수용 결정")
- 복원 메모: 이 문서·`docs/limits-check.md`·`logs/`·`captures/`는 Phase 0 중 작성됐다가 `docs/` 교체 때 유실됐다. 문서는 작성 원문에서 복원했고, 로그·캡처는 2026-10-27T10:5x UTC에 **다시 실행해** 만들었다. 한 번만 실행하는 생성 명령(`d1 create`·`vectorize create`·`migrations apply --remote`·`wrangler deploy`)의 원본 출력은 다시 만들 수 없어, 같은 사실을 보여 주는 현재 상태 조회(`d1 info`·`vectorize get`·`d1 migrations list --remote`·`deployments list`)로 대체했다.

## 완료 기준 대조

| # | 완료 기준(PHASES.md 원문) | 결과 | 증거 |
|---|---|---|---|
| 1 | `pnpm -r test` 통과(projection-java 제외) | 통과 — worker 22, web 2, gen·evals 테스트 없음(골격) | §1, `logs/phase-0-pnpm-r-test.log` |
| 2 | `wrangler deploy` 후 *.workers.dev에서 홈과 /api/v1/health 응답 | 통과 — 홈 200(HTML·번들에 "Hello, 데모GA"·고정 문구), `/api/v1/health` 200 `{"ok":true,"d1":1}` | §4, `logs/phase-0-live-check.log`, `logs/phase-0-wrangler-deployments.log`, `captures/phase-0-home-mobile.png` |
| 3 | docs/limits-check.md와 phase-0.md의 "사람 작업"이 Gemini 콘솔 캡처·GitHub Actions 조건·JDK 25 설치 3건뿐 | 충족 — 두 문서 모두 같은 3건 | `docs/limits-check.md` "사람 작업", 본 문서 "사람 작업" |

## 지시 항목별 산출물

| # | 지시 | 산출물 |
|---|---|---|
| 1 | 모노레포 골격 | `package.json`, `pnpm-workspace.yaml`(worker·web·gen·evals), `.nvmrc`(24), `.gitignore`, `projection-java/`(Gradle 9.3.0 래퍼, `build.gradle.kts`에 Java 25 툴체인 선언만), `contracts/`·`prompts/`·`data/`(`.gitkeep`), `docs/evidence/` |
| 2 | worker | `worker/wrangler.jsonc`(D1 `copilot`, Vectorize `rulebook-v1`, AI, Assets → `../web/dist`, `nodejs_compat`), `worker/src/index.ts`, `worker/src/api/health.ts`, `worker/worker-configuration.d.ts`(`wrangler types`) |
| 3 | D1 마이그레이션 0001 | `worker/migrations/0001_init.sql` — 상위 읽기 모델 8 + §5.1 추가 8 = 16 테이블, 인덱스 5 |
| 4 | web | `web/`(React 19.3.1, Vite 8.1.6, TS 5.9.3), `web/src/App.tsx`(Hello, 데모GA + 고정 문구 푸터), `web/src/disclaimer.ts` |
| 5 | deploy.yml | `.github/workflows/deploy.yml` — main 푸시 → `pnpm --filter @copilot/web build` → `wrangler deploy`, 시크릿 `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID`만 |
| 6 | 아키텍처 테스트 뼈대 | `worker/test/arch.test.ts`, `worker/test/arch-scan.ts`, 화이트리스트 `TENANT_SQL_WHITELIST`(`src/api/health.ts` 1건) |
| 7 | limits-check | `docs/limits-check.md` — 48행, 공식 원문 인용·페이지 갱신일·URL |

## 1. 테스트

```bash
$ NO_COLOR=1 pnpm -r test
```
```
gen test: No test files found, exiting with code 0
evals test: No test files found, exiting with code 0
web test:  Test Files  1 passed (1)
web test:       Tests  2 passed (2)
worker test:  Test Files  3 passed (3)
worker test:       Tests  22 passed (22)
exit=0
```
전체 로그: `docs/evidence/logs/phase-0-pnpm-r-test.log`

worker 테스트 구성(`@cloudflare/vitest-plugin`, Workers 런타임 + 로컬 D1, 원격 바인딩 끔):

- `test/health.test.ts` — `GET /api/v1/health` → `{ok:true, d1:1}`
- `test/schema.test.ts` — 마이그레이션 적용 후 테이블 16개·인덱스 5개 정확 일치, 읽기 모델 8표의 첫 컬럼 `tenant_id`·PK 포함·NOT NULL, STRICT로 금액 열 실수 거부(규약 8), 닫힌 값·월 형식·`tenant_id` 형식 CHECK
- `test/arch.test.ts` — 툴 디렉터리 쓰기 금지어, `src/**` SQL 문자열의 `tenant_id`, 화이트리스트 유효성, 스캐너 자체 검사

타입 검사: `cd worker && pnpm exec tsc --noEmit` 오류 0. `cd web && pnpm build`(= `tsc --noEmit && vite build`) 성공 — `logs/phase-0-web-build.log`.

## 2. 아키텍처 테스트가 위반을 잡는지(음성 대조)

`worker/src/tools/_violation_probe.ts`에 `INSERT INTO answer_log …`와 `SELECT * FROM earnings_line WHERE agent_id = ?`(tenant_id 없음)를 넣고 실행 → 2건 실패, 파일 삭제 후 통과.

```
     × 'src/tools/_violation_probe.ts' 에 INSERT|UPDATE|DELETE 가 없다 3ms
     × 'src/tools/_violation_probe.ts' 1ms
AssertionError: expected [ 'INSERT' ] to deeply equal []
AssertionError: expected [ …(2) ] to deeply equal []
      Tests  2 failed | 7 passed (9)
# 프로브 삭제 후 재실행
      Tests  8 passed (8)
```
로그: `docs/evidence/logs/phase-0-arch-negative.log`

## 3. 원격 리소스·마이그레이션

```bash
$ wrangler d1 create copilot                      # APAC, id f97c77d4-3afc-4ec3-ae17-d91bee6015dc
$ wrangler vectorize create rulebook-v1 --dimensions=1024 --metric=cosine
$ wrangler d1 migrations apply copilot --remote   # 0001_init.sql ✅, 22 commands
```

현재 상태 조회(재실행):

- `wrangler d1 info copilot` — region APAC, `num_tables 17`(16 + `d1_migrations`) — `logs/phase-0-d1-info.log`
- `wrangler d1 migrations list copilot --remote` — "No migrations to apply!" — `logs/phase-0-d1-migrations-remote.log`
- `sqlite_master` 조회 — **16 tables, 5 indexes** — `logs/phase-0-d1-remote-schema.log`
- `wrangler vectorize get rulebook-v1` — 1024, cosine, 2026-10-27T10:36:42Z 생성 — `logs/phase-0-vectorize-get.log`

## 4. 배포·공개 URL

workers.dev 서브도메인이 계정에 없어 첫 배포가 실패했다(wrangler가 자동 시도한 `copilot-worker`는 사용 중). 운영자 선택으로 계정 서브도메인 `ga-copilot-demo`를 Cloudflare API(`PUT /accounts/{id}/workers/subdomain`)로 등록한 뒤 재배포.

```bash
$ pnpm --filter @copilot/web build    # dist/assets/index-CNrsPeAl.js 219.97 kB │ gzip 68.84 kB
$ cd worker && wrangler deploy        # 바인딩 DB(copilot)·VECTORIZE(rulebook-v1)·AI·ASSETS
```

`wrangler deployments list`(재실행, 작성자 이메일은 `<account-email>`로 가림):
```
Created:     2026-10-27T10:43:32.663Z
Source:      Upload
Version(s):  (100%) 26b22aa1-9dc1-4559-b6a5-51900506f0fa
```
로그: `logs/phase-0-wrangler-deployments.log`

공개 URL 확인(2026-10-27T10:55:03Z 재실행. 최초 확인은 10:46:16Z, 새 서브도메인 TLS 발급 약 2분 대기 후):

```
$ curl -sS -i https://ga-commission-copilot.ga-copilot-demo.workers.dev/api/v1/health
HTTP/2 200
content-type: application/json
{"ok":true,"d1":1}

$ curl -sS -i https://ga-commission-copilot.ga-copilot-demo.workers.dev/
HTTP/2 200
content-type: text/html
    <title>GA 수수료 설명 코파일럿 (데모)</title>
    <script type="module" crossorigin src="/assets/index-CNrsPeAl.js"></script>

$ (번들에서 홈 문구·고정 문구 확인)
가상 데모 데이터 · 설계사 참고용 · 비확정 · 고객 제시 불가
Hello, 데모GA

$ curl -sS -i https://ga-commission-copilot.ga-copilot-demo.workers.dev/me/earnings/202608   # SPA fallback
HTTP/2 200
    <title>GA 수수료 설명 코파일럿 (데모)</title>
```
로그: `docs/evidence/logs/phase-0-live-check.log`

캡처(헤드리스 Chrome, 390×844 모바일 뷰포트): `docs/evidence/captures/phase-0-home-mobile.png` — "Hello, 데모GA" 제목과 고정 문구 푸터 렌더 확인.

## 결정·편차

- **테스트 패키지: `@cloudflare/vitest-pool-workers` → `@cloudflare/vitest-plugin@1.4.8`.** 구 패키지 README가 "Deprecated … renamed to `@cloudflare/vitest-plugin` … will not receive future updates"라고 적는다. 운영자 승인, 설계서 v0.1.2 §11·§13·CLAUDE.md 반영됨.
- **버전 고정(정확 버전, `^` 없음):** hono 4.13.14(4.13.x 최신), vite 8.1.6(설계서 라인 8.1의 최신 패치. 최신은 8.3.5), react·react-dom 19.3.1, @vitejs/plugin-react 6.1.2(peer `vite ^8.0.0`), wrangler 4.153.0, vitest 4.1.12(vitest 5.0.5는 engines가 `node ^22.12 || ^24 || >=26`로 로컬 Node 25를 제외하고, 4.1.x는 plugin peer `^4.1.0 || ^5.0.0`을 만족), typescript 5.9.3(7.x는 네이티브 포트라 도구 호환을 위해 5.x 최신 유지), @types/node 24.19.2(CI Node 24).
- **SQLite 변환:** 모든 표 `STRICT`(INTEGER 열에 실수 거부 — 규약 8), PK 열에 `NOT NULL` 명시(SQLite는 비정수 PK에 NULL 허용), 상위 정규식 CHECK는 D1에 REGEXP가 없어 GLOB·length로 같은 규칙 표현, 닫힌 값 CHECK는 상위 V1·V4 그대로. `limit_multiple`은 V5대로 TEXT(decimalString). §5.1 추가 표는 DDL 그대로(+STRICT·PK NOT NULL).
- **상위 §5 컬럼명 ↔ 본 설계서 §5.1·§7 참조 이름:** `calc_id`, `ledger_id`, `close_ym`, `basis`, `policy_summary`, `deferral_item.reason(LIMIT_DEFER)`, `policy_limit_history` 모두 일치 → DECISIONS.md 기록 대상 없음.
- **Assets:** `run_worker_first: ["/api/*"]`, `not_found_handling: "single-page-application"`.
- **테스트에서 원격 바인딩 끔(`remoteBindings: false`):** AI·Vectorize 테스트가 계정 무료 한도를 쓰지 않게 했다. Vectorize는 로컬 개발을 지원하지 않는다는 wrangler 경고가 나온다.
- **workers.dev 서브도메인 `ga-copilot-demo` 등록:** 계정 수준 설정, 운영자 선택.

## 수용 결정 (2026-10-27, 운영자)

1. 설계서 반영 — 운영자가 v0.1.2로 교체. 반영 제안 12건과의 대조 결과(반영됨 5건·남은 차이 10건)는 `docs/limits-check.md` "설계서 반영 (v0.1.2 대조)"에 목록으로만 남겼다. 설계서는 고치지 않았다. 예산 수치(§6.2·§10.4) 유지.
2. `@cloudflare/vitest-plugin` 승인 — 되돌리지 않는다.
3. Vectorize 초과 동작 "원문 미기재" 확정 — `limits-check.md` #14를 "원문 미기재(확인 불가)"로 닫음. 사람 작업 아님.
4. git 초기화·첫 커밋 — `phase-0: 골격·D1 스키마·health·deploy 워크플로·한도 재확인`. 푸시하지 않는다.

- 2026-12-01 로그 요금 전환 — Free 0.5GB/일·7일 보존이면 /budget 7일 집계(§8-6, Phase 7)는 영향 없음, 수집량 모니터링만.

## 사람 작업

- [ ] Gemini API Free 한도 — AI Studio 콘솔에서 프로젝트별 RPM·TPM·RPD 캡처(공식 페이지에 표 없음) → `docs/evidence/captures/phase-0-gemini-limits.png`
- [ ] GitHub Actions 무료 조건 적용 확인 — 저장소 `hjryoo-ai/ga-commission-copilot`을 public으로 생성(`gh repo create hjryoo-ai/ga-commission-copilot --public --source . --remote origin` — Claude Code의 생성 시도는 자동 모드 권한 분류기에 거부됨)한 뒤 Settings → Billing에서 Actions 사용 0원/무료 상태 캡처 → `docs/evidence/captures/phase-0-gh-actions.png`. 같은 때 Actions Secrets `CLOUDFLARE_API_TOKEN`(Workers Scripts·D1 편집 권한)·`CLOUDFLARE_ACCOUNT_ID` 등록. 푸시는 운영자 지시 후
- [ ] JDK 25 설치 — 로컬 `java -version`은 Corretto 21.0.9. `projection-java`의 `./gradlew build`는 다른 프로젝트가 `~/.gradle/jdks`에 자동 내려받은 Temurin 25.0.4.1로만 동작하며 Gradle이 "auto-provisioning without toolchain repositories … deprecated … will fail with an error in Gradle 10"을 경고한다(`logs/phase-0-projection-java-build.log`). Claude Code의 설치 시도(Adoptium 공식 tarball → `~/Library/Java/JavaVirtualMachines`)는 자동 모드 권한 분류기에 거부됐다. Phase 1 항목 4 전에 설치하고 `java -version` 출력을 기록

## 남은 이슈

- 설계서 v0.1.2와 공식 원문의 남은 차이 10건(`limits-check.md` "남은 차이") — 보고만, 설계서 수정 안 함. 그중 1번(`/api/*` 한도 초과 시 Error 1027 vs `run_worker_first` 429)은 저하 모드 프론트 구현(Phase 5)에 영향.
- Vectorize 로컬 미지원 — Phase 4 "Vectorize 로컬 바인딩" 테스트 설계 때 결정.
