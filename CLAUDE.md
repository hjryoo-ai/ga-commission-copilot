# CLAUDE.md — ga-commission-copilot

이 저장소는 `docs/GA수수료설명코파일럿_설계서.md`(v0.1)를 정본으로 구현한다. 설계서와 코드가 어긋나면 설계서를 먼저 고치고(같은 커밋), 그다음 코드를 고친다. 상위 저장소 `ga-agent-portal`의 `GA설계사대시보드_설계서.md`(v1.9)는 상속 문서이며 읽기 모델 스키마·이벤트 카탈로그·골든 시나리오의 출처다.

## 작업 순서

- 항상 `docs/PHASES.md`의 현재 Phase 지시만 수행한다. 다음 Phase 코드를 미리 만들지 않는다.
- Phase 완료 시 `docs/evidence/phase-N.md`에 테스트 명령·출력·캡처 경로를 남긴다. 증거 없는 완료 선언은 받지 않는다.
- 설계서 §14.1 미결정 항목을 만나면 임의 결정하지 말고 `docs/DECISIONS.md`에 선택지와 근거를 적은 뒤 질문한다.

## 절대 규약 (코드 리뷰에서 자동 거부)

1. **LLM은 숫자를 만들지 않는다.** 모든 LLM 출력은 `GroundingVerifier`(G4·G5·G6)를 통과해야 저장·응답된다. 검증기를 우회하는 경로를 만들지 않는다.
2. **금액 계산 코드는 `DerivedNumbers` 클래스 밖에 두지 않는다.** 합계·잔여·소진율만 허용. 요율 곱하기·세액 계산·환수액 계산 금지(그건 엔진 영역).
3. **`tenant_id`·`agent_id` 조건 없는 쿼리 금지.** 저장소 계층은 `ScopedQuery` 빌더만 사용. 아키텍처 테스트가 원시 SQL을 스캔한다.
4. **툴은 읽기 전용.** `worker/src/tools/**`에 `INSERT`·`UPDATE`·`DELETE` 금지. `agentId`는 서버가 주입하고 LLM 인자에서 받지 않는다.
5. **예산 카운터는 D1**(`budget_counter`). KV에 카운터 두지 않는다. 카운터 갱신은 `UPDATE … SET used = used + 1 WHERE used < ?` 단일 문장.
6. **무료 한도 밖 리소스 사용 금지.** 유료 플랜 전제 기능(Workers Paid 전용 모델, Logpush, Hyperdrive 등) 사용 불가. 새 외부 서비스 추가 시 설계서 §10에 공식 출처와 한도를 먼저 적는다.
7. **금지 표현·고정 문구.** 사용자 노출 LLM 텍스트에는 "확정", "보장", "고객에게 안내"를 쓰지 않고, 모든 LLM 블록에 `disclaimer` 고정 문구를 붙인다.
8. **double 금지.** 금액은 정수 원(`number`는 `Number.isSafeInteger` 검사, Java는 `long`/`Won`).
9. **마감월 불변.** `earnings_month.status ∈ {CONFIRMED, PAID}`인 월의 라인·합산을 바꾸는 코드 경로는 없다.
10. **시크릿은 코드·커밋에 없다.** `.dev.vars`·`wrangler secret`·GitHub Secrets만. `.dev.vars.example`만 커밋.

## 저장소 구조와 의존 방향

설계서 §3.3. `web → worker API`, `worker → D1/Vectorize/Workers AI/외부 LLM`, `gen → providers + verify`, `verify → projection-java`. 역방향 import는 ESLint `import/no-restricted-paths`로 막는다.

## 자주 쓰는 명령

```bash
# worker
cd worker && pnpm install && pnpm dev            # wrangler dev (D1/Vectorize/AI 로컬 바인딩)
pnpm test                                        # vitest (@cloudflare/vitest-plugin)
pnpm wrangler d1 migrations apply copilot --local
pnpm wrangler deploy

# web
cd web && pnpm install && pnpm dev && pnpm build && pnpm test

# gen (오프라인 생성, 로컬에서는 VCR 스텁으로)
cd gen && pnpm run world:plan --stub && pnpm run world:expand && pnpm run verify
pnpm run explain --stream data/stream/<hash>.jsonl --stub
pnpm run rulebook --stub

# projection-java (불변식·결정론)
cd projection-java && ./gradlew test

# evals (실호출은 Phase 종료 시에만, 평소 --stub)
cd evals && pnpm run eval --stub
```

## LLM 호출 규칙 (개발 중)

- 로컬·CI 테스트는 `providers/vcr/`의 녹화 응답을 재생한다(`--stub`). 실호출은 Phase 종료 평가와 주간 배치에서만.
- 실호출 시 공급자 순서·예산은 설계서 §6.2를 따른다. 개발용 실호출도 `budget_counter`(scope=`dev`)에 집계한다.
- 프롬프트는 `prompts/<name>/v<N>.md`에만 둔다. 코드 문자열에 프롬프트를 쓰지 않는다. 변경은 새 버전 파일 + `CHANGELOG.md`.

## 커밋·PR

- 커밋 메시지: `phase-N: <무엇을>` 또는 `prompt(answer): v5 — <왜>`.
- `prompts/**` 변경 PR은 `eval-on-prompt-change` 체크 통과가 필수.
- 설계서 수정은 `docs:` 접두어, 변경 이력 표에 한 줄 추가.

## 하지 않는 것

- 로그인·실제 설계사 계정·실제 엔진 연동(설계서 §2.2).
- LLM-as-judge 채점(§13.1).
- 의미 유사 질문의 캐시 병합(§6.4).
- 실존 보험사·상품·인물 이름 생성(§9).
