# 무료 한도 재확인 (설계서 §10)

- 확인일: 2026-10-27 (열람자: Claude Code)
- 상태 범례: 확인 = 공식 원문에서 수치 일치 · 변경 = 공식 원문이 설계서와 다름 · 미확인 = 공식 원문으로 확인 못 함(사람 작업) · 원문 미기재(확인 불가) = 공식 원문에 서술 자체가 없음(사람 작업 대상 아님)
- 열람 방법: Cloudflare 문서는 각 페이지의 `index.md`(공식 "View as Markdown") 원문, GitHub 문서는 `docs.github.com/api/article/body?pathname=…`(공식 문서 본문 API), Groq·OpenRouter·Gemini·Vercel·Supabase는 각 사이트가 제공하는 `.md`/`.md.txt` 원문 또는 서버 렌더 HTML을 받아 수치를 그대로 옮겼다. 기억이나 제3자 요약으로 채운 값은 없다.
- "페이지 갱신일"은 페이지에 표시된 날짜(Cloudflare "Last updated", Google "Last updated … UTC", Vercel `last_updated`)다. 표시가 없으면 "표시 없음"으로 적었다.
- "설계서 §10 값"은 확인 당시 설계서 v0.1.1의 값이다. "(미기재)"인 행은 설계서에 없던 공식 조건으로, 반영을 제안한 항목이다. v0.1.2 반영 결과는 맨 아래 "설계서 반영"에 있다.
- 복원 메모: 이 파일은 2026-10-27 Phase 0 중 작성됐다가 `docs/` 교체 때 유실되어, 같은 날 작성 원문에서 복원했다(수치·인용 변경 없음). #14 상태와 "설계서 반영" 절만 Phase 0 수용 결정에 따라 갱신했다.

| # | 서비스 | 항목 | 설계서 §10 값 | 공식 원문 값(인용) | 상태 | 페이지 갱신일 | 출처 URL |
|---|---|---|---|---|---|---|---|
| 1 | Workers | 일일 요청·리셋 | 100,000 요청/일, 자정 UTC 리셋 | "Accounts on the Workers Free plan have a daily request limit of 100,000 requests, resetting at midnight UTC." | 확인 | 2026-10-12 | https://developers.cloudflare.com/workers/platform/limits/ |
| 2 | Workers | CPU 시간 | 10ms/호출 | "CPU time per HTTP request \| 10 ms" (Workers Free) | 확인 | 2026-10-12 | https://developers.cloudflare.com/workers/platform/limits/ |
| 3 | Workers | 버스트 | 1,000 요청/분 | 한도 표에 버스트 항목 없음. "Workers scale automatically across the Cloudflare global network. There is no general limit on requests per second." | 변경 | 2026-10-12 | https://developers.cloudflare.com/workers/platform/limits/ |
| 4 | Workers | 서브리퀘스트 | 50/호출 | "Subrequests per invocation \| 50" · "Subrequests to internal services \| 1,000" (Free). 정의: "A subrequest is any request a Worker makes using the Fetch API or to Cloudflare services like R2, KV, or D1." | 확인 (내부 서비스 1,000은 미기재) | 2026-10-12 | https://developers.cloudflare.com/workers/platform/limits/ |
| 5 | Workers | 네트워크 대기 | CPU 시간에 불포함 | "Waiting on network requests (such as `fetch()` calls, KV reads, or database queries) does **not** count toward CPU time." | 확인 | 2026-10-12 | https://developers.cloudflare.com/workers/platform/limits/ |
| 6 | Workers | 초과 시 | 요청 거부(과금 없음) | "When a Worker exceeds this limit, Cloudflare returns **Error 1027**." · "Fail open \| Bypasses the Worker. Requests behave as if no Worker is configured." · "Fail closed \| Returns a Cloudflare `1027` error page." | 변경 (Error 1027, 라우트 fail open/closed에 따라 동작 다름) | 2026-10-12 | https://developers.cloudflare.com/workers/platform/limits/ |
| 7 | Workers 정적 자산 | Worker 요청 한도 집계 여부 | 미집계(무제한), 출처 flarecalc(제3자) | "Requests to static assets are free and unlimited. Requests to the Worker script (for example, in the case of SSR content) are billed according to Workers pricing." · 요금표 각주: "<sup>3</sup> Requests to static assets are free and unlimited." | 확인 (공식 출처로 교체) | 2026-04-23 (billing-and-limitations) · 2026-10-02 (pricing) | https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ · https://developers.cloudflare.com/workers/platform/pricing/ |
| 8 | Workers 정적 자산 | `run_worker_first` 주의 | (미기재) | "**Important note for free tier users**: When using `run_worker_first`, requests matching the specified patterns will always invoke your Worker script. If you exceed your free tier request limits, these requests will receive a 429 (Too Many Requests) response instead of falling back to static asset serving. Negative patterns (patterns beginning with `!/`) will continue to serve assets correctly, as requests are directed to assets, without invoking your Worker script." | 확인 | 2026-04-23 | https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ |
| 9 | Workers 정적 자산 | Workers Caching 사용 시 | (미기재) | "<sup>4</sup> When Workers Caching is enabled, requests served from the Worker's cache are billed at the same per-request rate as requests that invoke the Worker. This includes requests to static assets and worker-to-worker invocations." | 확인 | 2026-10-02 | https://developers.cloudflare.com/workers/platform/pricing/ |
| 10 | Workers 정적 자산 | 파일 수·크기 | (미기재) | "Files per Worker version \| 20,000" (Free) · "Individual file size \| 25 MiB" | 확인 | 2026-10-12 | https://developers.cloudflare.com/workers/platform/limits/ |
| 11 | D1 | 읽기·쓰기·저장 | 500만 행 읽기/일, 10만 행 쓰기/일, 저장 5GB(계정 합) | "Rows read \| 5 million / day" · "Rows written \| 100,000 / day" · "Storage (per GB stored) \| 5 GB (total)" | 확인 | 2026-04-21 | https://developers.cloudflare.com/d1/platform/pricing/ |
| 12 | D1 | 초과 시·리셋·무료 유지 | 당일 쿼리 오류, 00:00 UTC 리셋, "무료 플랜은 항상 유지" | "When your account hits the daily read and/or write limits, you will not be able to run queries against D1. D1 API will return errors to your client indicating that your daily limits have been exceeded." · "Free limits reset daily at 00:00 UTC." · "Yes, the Workers Free plan will always include the ability to prototype and experiment with D1 for free." | 확인 | 2026-04-21 | https://developers.cloudflare.com/d1/platform/pricing/ |
| 13 | Vectorize | 질의·저장 차원 | 질의 3,000만 차원/월, 저장 500만 차원 | "Total queried vector dimensions \| 30 million queried vector dimensions / month" · "Total stored vector dimensions \| 5 million stored vector dimensions" (Workers Free). 계산식: "`((queried vectors + stored vectors) * dimensions * …)`" | 확인 | 2026-04-21 | https://developers.cloudflare.com/vectorize/platform/pricing/ |
| 14 | Vectorize | Free 초과 시 동작 | 원문 미기재 (v0.1.1: "유료 플랜 전환 필요" → v0.1.2에서 정정) | 원문에 Free 플랜 초과 시 동작 서술 없음. 있는 문장은 "Will Vectorize always have a free tier? Yes, the Workers free tier will always include the ability to prototype and experiment with Vectorize for free." 와 유료 플랜 초과 FAQ뿐 | 원문 미기재(확인 불가) — Phase 0 수용 결정으로 확정, 사람 작업 아님 | 2026-04-21 | https://developers.cloudflare.com/vectorize/platform/pricing/ |
| 15 | Vectorize 한계 | 벡터당 차원·메타데이터 | 1,536차원(float32), 메타데이터 10KiB/벡터 | "Maximum dimensions per vector \| 1536 dimensions, 32 bits precision" · "Precision per vector dimension \| 32 bits (float32)" · "Metadata per vector \| 10KiB" | 확인 | 2026-08-05 | https://developers.cloudflare.com/vectorize/platform/limits/ |
| 16 | Vectorize 한계 | 인덱스당 벡터 수 | 1,000만 벡터 | "Maximum vectors per index \| 20,000,000" (같은 페이지의 200,000은 deprecated V1 인덱스 표. `rulebook-v1`은 Wrangler 4로 만든 V2 인덱스) | 변경 (1,000만 → 2,000만) | 2026-08-05 | https://developers.cloudflare.com/vectorize/platform/limits/ |
| 17 | Vectorize 한계 | Free 계정 인덱스·네임스페이스 | (미기재) | "Indexes per account \| 50,000 (Workers Paid) / 100 (Free)" · "Maximum namespaces per index \| 50,000 (Workers Paid) / 1000 (Free)" · "Maximum returned results (`topK`) with values or metadata \| 50" | 확인 | 2026-08-05 | https://developers.cloudflare.com/vectorize/platform/limits/ |
| 18 | Workers AI | 일일 무료 뉴런·리셋·초과 | 10,000뉴런/일, 00:00 UTC 리셋, 초과 시 실패(Free) 또는 $0.011/1,000뉴런(Paid) | "Our free allocation allows anyone to use a total of **10,000 Neurons per day at no charge**." · "All limits reset daily at 00:00 UTC. If you exceed any one of the above limits, further operations will fail with an error." · "Workers Free \| 10,000 Neurons per day \| N/A - Upgrade to Workers Paid" · "Workers Paid \| 10,000 Neurons per day \| $0.011 / 1,000 Neurons" | 확인 | 2026-10-20 | https://developers.cloudflare.com/workers-ai/platform/pricing/ |
| 19 | Workers AI | 결제 수단 필요 모델 | kimi-k2.6, glm-5.x, deepseek-v4 계열 | "Some models require a paid billing method. This applies to `@cf/moonshotai/kimi-k2.6`, `@cf/moonshotai/kimi-k2.7-code`, `@cf/zai-org/glm-5.2`, `@cf/zai-org/glm-5.3`, `@cf/zai-org/glm-5.3-flash`, `@cf/deepseek-ai/deepseek-v4-flash-0731`, `@cf/deepseek-ai/deepseek-v4.1-flash-1017`, and `@cf/deepseek-ai/deepseek-v4-pro-0813`. You can access these models with either the Workers Paid plan or prepaid AI Gateway credits." | 변경 (목록에 `kimi-k2.7-code` 추가, 선불 AI Gateway 크레딧으로도 접근 가능) | 2026-10-20 | https://developers.cloudflare.com/workers-ai/platform/pricing/ |
| 20 | Workers AI 단가 | `@cf/openai/gpt-oss-120b` | 입력 31,818 · 출력 68,182 (뉴런/100만 토큰) | "\| @cf/openai/gpt-oss-120b \| $0.350 per M input tokens <br> $0.750 per M output tokens \| 31818 neurons per M input tokens <br> 68182 neurons per M output tokens \|" | 확인 | 2026-10-20 | https://developers.cloudflare.com/workers-ai/platform/pricing/ |
| 21 | Workers AI 단가 | `@cf/openai/gpt-oss-20b` | 입력 18,182 · 출력 27,273 | "\| @cf/openai/gpt-oss-20b \| $0.200 per M input tokens <br> $0.300 per M output tokens \| 18182 neurons per M input tokens <br> 27273 neurons per M output tokens \|" | 확인 | 2026-10-20 | https://developers.cloudflare.com/workers-ai/platform/pricing/ |
| 22 | Workers AI 단가 | `@cf/qwen/qwen3-30b-a3b-fp8` | 입력 4,625 · 출력 30,475 | "\| @cf/qwen/qwen3-30b-a3b-fp8 \| $0.051 per M input tokens <br> $0.335 per M output tokens \| 4625 neurons per M input tokens <br> 30475 neurons per M output tokens \|" | 확인 | 2026-10-20 | https://developers.cloudflare.com/workers-ai/platform/pricing/ |
| 23 | Workers AI 단가 | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 입력 26,668 · 출력 204,805 | "\| @cf/meta/llama-3.3-70b-instruct-fp8-fast \| $0.293 per M input tokens <br> $2.253 per M output tokens \| 26668 neurons per M input tokens <br> 204805 neurons per M output tokens \|" | 확인 | 2026-10-20 | https://developers.cloudflare.com/workers-ai/platform/pricing/ |
| 24 | Workers AI 단가 | `@cf/baai/bge-m3` | 입력 1,075 | "\| @cf/baai/bge-m3 \| $0.012 per M input tokens \| 1075 neurons per M input tokens \|" | 확인 | 2026-10-20 | https://developers.cloudflare.com/workers-ai/platform/pricing/ |
| 25 | Workers KV | Free 한도 | 저장 1GB, 읽기 100,000/일, 쓰기·삭제·목록 1,000/일 | plans.md: "Workers KV \| Stored Data: 1 GB, Read Requests: 100,000 / day, Write, Delete, List requests: 1,000 / day" · Workers pricing: "Keys read \| 100,000 / day" "Keys written \| 1,000 / day" "Keys deleted \| 1,000 / day" "List requests \| 1,000 / day" "Stored data \| 1 GB" · "All limits reset daily at 00:00 UTC. If you exceed any one of these limits, further operations of that type will fail with an error." | 확인 | plans.md 표시 없음 · pricing 2026-10-02 | https://www.cloudflare.com/plans.md · https://developers.cloudflare.com/workers/platform/pricing/ |
| 26 | AI Gateway | 핵심 기능·DLP | 핵심 기능(분석·캐시·레이트리밋) 전 플랜 무료, DLP 무료 | "AI Gateway's core features available today are offered for free … Core features include: dashboard analytics, caching, and rate limiting." · "DLP scanning in AI Gateway is free on all plans." | 확인 (페이지 갱신일은 설계서 기재 2026-09-24 → 2026-10-15) | 2026-10-15 | https://developers.cloudflare.com/ai-gateway/reference/pricing/ |
| 27 | AI Gateway | 로그 방식 기준 | 2026-09-24 이후 **생성 게이트웨이**는 Workers Logs, 그 이전은 레거시 | "Accounts that created their first gateway on or after September 24, 2026 store logs in Workers Logs" · "Accounts that created a gateway before September 24, 2026 use Legacy Logs." | 변경 (게이트웨이 단위 → 계정의 첫 게이트웨이 생성일 기준) | 2026-10-15 | https://developers.cloudflare.com/ai-gateway/reference/pricing/ |
| 28 | AI Gateway | 레거시 로그 한도 | 계정당 100,000건 | "Workers Free \| 100,000 logs total across all gateways" · "Logs stored, free plan \| 100,000 per account" | 확인 | 2026-10-15 (pricing) · 2026-09-24 (limits) | https://developers.cloudflare.com/ai-gateway/reference/pricing/ · https://developers.cloudflare.com/ai-gateway/reference/limits/ |
| 29 | AI Gateway / Workers Logs | Workers Logs Free 한도 | 이벤트 200,000/일, 3일 보존 | 현재: "**Workers Free** \| 200,000 per day \| 3 Days". 예정: "Beginning December 1, 2026, Workers Logs will use Cloudflare Observability pricing." → Observability: "Free \| 0.5 GB per day \| Seven-day retention included \| Not available" · "On Free, Cloudflare stops ingesting new data when the account reaches its daily limit. Ingestion resumes when the allowance resets at 00:00 UTC." (포함 대상에 "AI Gateway logs" 명시) | 변경 (2026-12-01부터 이벤트 수 → 0.5 GB/일·7일 보존) | 2026-10-12 (workers-logs) · 2026-10-25 (observability) | https://developers.cloudflare.com/workers/observability/logs/workers-logs/ · https://developers.cloudflare.com/observability/pricing/ |
| 30 | AI Gateway | 게이트웨이 수 | (미기재) | "Gateways free plan \| 10 per account" | 확인 | 2026-09-24 | https://developers.cloudflare.com/ai-gateway/reference/limits/ |
| 31 | Groq | `openai/gpt-oss-120b` 한도 | 30 RPM · 1,000 RPD · 8K TPM · 200K TPD | "\| openai/gpt-oss-120b \| 30 \| 1K \| 8K \| 200K \| \- \| \- \|" (열: MODEL ID \| RPM \| RPD \| TPM \| TPD \| ASH \| ASD). 서버 렌더 HTML에서 이 표는 기본 선택 탭 "Free Plan Limits" 아래에 있음(옆 탭 "Developer Plan Limits"). 주의 문장: "Note that the limits shown below are the base limits for the Developer plan, and higher limits are available for select workloads and enterprise use cases." | 확인 (탭 라벨 기준. 문구 모호 — 아래 비고) | 표시 없음 | https://console.groq.com/docs/rate-limits |
| 32 | Groq | `openai/gpt-oss-20b`·`qwen/qwen3.8-27b` | 30 RPM · 1,000 RPD · 8K TPM · 200K TPD | "\| openai/gpt-oss-20b \| 30 \| 1K \| 8K \| 200K \|" · "\| qwen/qwen3.8-27b \| 30 \| 1K \| 8K \| 200K \|" | 확인 | 표시 없음 | https://console.groq.com/docs/rate-limits |
| 33 | Groq | 적용 단위·캐시·초과 | 조직 단위·모델별 적용, 캐시 토큰 미집계, 429 + `retry-after` | "Rate limits apply at the organization level, not individual users." · "Cached tokens do not count towards your rate limits." · "When you exceed rate limits, our API returns a `429 Too Many Requests` HTTP status code." · "`retry-after` is only set if you hit the rate limit and status code 429 is returned." (모델별은 표가 모델 ID별로 나뉜 것으로 확인, 별도 문장 없음) | 확인 | 표시 없음 | https://console.groq.com/docs/rate-limits |
| 34 | Groq | 무료 조건 | 카드 없이 가입, Free 플랜 과금 없음(초과분은 429만). 출처 community.groq.com | 커뮤니티 URL은 301 → https://groq.com/ 로 이동(글 없음). 공식 Billing FAQ: "To upgrade from the Free tier to the Developer tier, you'll need to provide a valid payment method (credit card, US bank account, or SEPA debit account)." · 다운그레이드 후: "Your account returns to Free tier rate limits and restrictions" "Any usage-based charges stop immediately" | 확인 (출처를 공식 Billing FAQ로 교체 필요) | 표시 없음 | https://console.groq.com/docs/billing-faqs |
| 35 | OpenRouter `:free` | RPM·RPD | 20 RPM, 누적 결제 $10 미만 50 RPD, $10 이상 1,000 RPD(영구) | "\| Credits purchased (all time) \| Requests per minute \| Requests per day \|" "\| Less than 10 \| 20 \| 50 \|" "\| At least 10 \| 20 \| 1000 \|" · FAQ: "If you have purchased at least 10 credits, your free model rate limit will be 1000 requests per day. Otherwise, you will be rate limited to 50 free model API requests per day." | 확인 | 표시 없음 | https://openrouter.ai/docs/api_reference/limits (원 URL `/docs/api/reference/limits`에서 리다이렉트) · https://openrouter.ai/docs/faq |
| 36 | OpenRouter `:free` | 적용 범위 | 계정 전체 기준, **모델별 아님** | "Making additional accounts or API keys will not affect your rate limits, as we govern capacity globally. We do however have different rate limits for different models, so you can share the load that way if you do run into issues." · FAQ: "These models have low rate limits (50 requests per day total)" | 변경 (RPD는 계정 합계가 맞으나 "모델별 아님"은 원문과 충돌 — 모델마다 다른 한도 존재 명시) | 표시 없음 | https://openrouter.ai/docs/api_reference/limits · https://openrouter.ai/docs/faq |
| 37 | OpenRouter `:free` | 가입 조건·가용성·주의 | 카드 없이 가입, 무료 용량은 변동·중단 가능 | FAQ: "All new users receive a small free allowance to test out OpenRouter. There are many free models available on OpenRouter." · free 변형: "Free variants provide access to models without cost, but may have different rate limits or availability compared to paid versions." · 추가: "If your account has a negative credit balance, you may see errors, including for free models." · "Fallbacks to paid models are billed … To keep a request free, list only `:free` models in `models`" | 확인 (부정 잔액·유료 폴백 과금 주의는 미기재) | 표시 없음 | https://openrouter.ai/docs/faq · https://openrouter.ai/docs/guides/routing/model-variants/free.md · https://openrouter.ai/docs/api_reference/limits |
| 38 | Gemini API | 무료 조건 | 활성 프로젝트 또는 무료 체험, 결제 연결 불필요, 지출 한도 없음 | "\| **Free** \| Active project or free trial \| N/A \|" (열: Usage tier \| Qualification \| Billing tier cap) · "\| **Free** \| N/A \|" (Spend rate limit per 10 minutes) · "To transition from the Free tier to a paid tier, you must first set up billing in AI Studio." | 확인 | 2026-10-26 | https://ai.google.dev/gemini-api/docs/rate-limits |
| 39 | Gemini API | 리셋·적용 단위·배치 | RPD 태평양 시간 자정 리셋, 배치 API 별도 한도, 프로젝트별 | "Rate limits are applied per project, not per API key. Requests per day (**RPD**) quotas reset at midnight Pacific time." · "Batch API requests are subject to their own rate limits, separate from the non-batch API calls." · "Specified rate limits are not guaranteed and actual capacity may vary." | 확인 | 2026-10-26 | https://ai.google.dev/gemini-api/docs/rate-limits |
| 40 | Gemini API | 모델별 RPM·TPM·RPD 수치 | 공식 페이지에 표 없음, AI Studio 콘솔에서만 확인 | 페이지에 모델별 Free 수치 표 없음: "Rate limits depend on a variety of factors (such as your usage tier) and can be viewed in Google AI Studio." · "View your active rate limits in AI Studio" (https://aistudio.google.com/rate-limit) | 미확인 (사람 작업 — 콘솔 캡처) | 2026-10-26 | https://ai.google.dev/gemini-api/docs/rate-limits |
| 41 | GitHub Actions | 공개 저장소 표준 러너 과금 | 공식 확인 미수행 | "GitHub Actions usage is **free** for **self-hosted runners** and for **public repositories** that use standard GitHub-hosted runners." · "Use of the standard GitHub-hosted runners is free and unlimited on public repositories." · "The use of standard GitHub-hosted runners is free: In public repositories …" | 확인 (문서 기준. 우리 저장소 적용은 사람 작업) | 표시 없음 | https://docs.github.com/en/billing/concepts/product-billing/github-actions · https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job |
| 42 | GitHub Actions | 무료가 아닌 경우 | (미기재) | "Larger runners are always charged for, even when used by public repositories or when you have quota available from your plan." · "For **private repositories**, each GitHub account receives a quota of free minutes, artifact storage, and cache storage …" (GitHub Free: "500 MB" artifact · "2,000" minutes/month · "10 GB" cache per repository) | 확인 | 표시 없음 | https://docs.github.com/en/billing/concepts/product-billing/github-actions |
| 43 | GitHub Actions | 동시 작업 수 | (미기재) | "\| Standard GitHub-hosted runner \| Free \| 20 \| 5 \| Not applicable \|" (열: Total concurrent jobs \| Maximum concurrent macOS jobs \| GPU) | 확인 | 표시 없음 | https://docs.github.com/en/actions/reference/limits |
| 44 | GitHub Actions | 실행 시간 | (미기재) | "Job execution time \| 6 hours" (All GitHub-hosted runners) · "Workflow run time \| 35 days / workflow run" · "Job Matrix \| 256 jobs / workflow run" | 확인 | 표시 없음 | https://docs.github.com/en/actions/reference/limits |
| 45 | GitHub Actions | 캐시·아티팩트 저장 | (미기재) | "Cache storage: Actions cache storage is a separate allowance of 10 GB per repository." · "GitHub will remove any cache entries that have not been accessed in over 7 days. … By default, the limit is 10 GB per repository … Any usage beyond 10 GB is billed to your account." · "Actions artifacts and GitHub Packages storage share the same pooled allowance." · 캐시 업로드 "200 per minute", 다운로드 "1500 per minute" | 확인 | 표시 없음 | https://docs.github.com/en/billing/concepts/product-billing/github-actions · https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching · https://docs.github.com/en/actions/reference/limits |
| 46 | Supabase Free (기각) | 프로젝트·DB·일시정지 | 2개 프로젝트, DB 500MB, 7일 비활성 시 일시정지 → 수동 복구 전 접근 불가 (출처 제3자) | 가격 페이지: "500 MB database size" · "Free projects are paused after 1 week of inactivity. Limit of 2 active projects." · 문서: "Supabase pauses Free Plan projects that show low activity over a 7-day period" · "You can restore a paused project for up to 1 year after it was paused: … Click **Resume project** and confirm" | 확인 (공식 출처로 교체) | 표시 없음 | https://supabase.com/pricing · https://supabase.com/docs/guides/platform/free-project-pausing |
| 47 | Vercel Hobby (기각) | 용도·Git 조직 | 비상업·개인 용도 한정, Git 조직 저장소 연결 불가 | "the Hobby plan restricts users to non-commercial, personal use only." · "Vercel does not support connecting a project on your Hobby team to Git repositories owned by Git organizations." | 확인 | 2026-09-14 (hobby) · 2026-09-16 (limits) | https://vercel.com/docs/plans/hobby (원 URL `/docs/plans/hobby-plan`에서 리다이렉트) · https://vercel.com/docs/limits |
| 48 | Vercel Hobby (기각) | 출처 URL | https://docs.vercel.com/docs/limits | `https://docs.vercel.com/docs/limits` → HTTP 404. 같은 내용은 https://vercel.com/docs/limits 에 있음 | 변경 (출처 URL) | — | https://vercel.com/docs/limits |

### 비고

- **#31 Groq 표의 플랜 라벨.** `rate-limits.md` 원문에는 탭 라벨 없이 "the limits shown below are the base limits for the Developer plan" 문장만 있다. 서버 렌더 HTML에서는 같은 표가 기본 선택 탭 "Free Plan Limits"(활성 스타일) 아래에 나오고 옆에 "Developer Plan Limits" 탭이 있다. 수치는 설계서와 같고 탭 라벨 기준으로 Free 값으로 판단해 "확인"으로 적었다. 조직별 실제 한도는 "You can view the current, exact rate limits for your organization on the limits page"(https://console.groq.com/settings/limits)에 있으므로 Phase 1에서 키를 만들 때 콘솔 값과 한 번 대조하면 좋다(체크박스 항목은 아님).
- **#14 Vectorize Free 초과 시 동작**은 공식 원문에 서술이 없다. Phase 0 수용 결정(2026-10-27)으로 설계서 v0.1.2가 "원문 미기재"로 확정했고, 이 행은 "원문 미기재(확인 불가)"로 닫는다. 사람 작업 대상이 아니다.
- **#16 Vectorize 페이지의 두 표.** 같은 페이지 아래 접힌 "Limits for V1 indexes (deprecated)" 표에는 "Maximum vectors per index \| 200,000"이 있다. V2 인덱스(현재 생성 기본)는 20,000,000이다.
- **Vectorize 질의 차원 계산식**은 "(queried vectors + stored vectors) × dimensions"(월 단위)다. §10.4의 "150질의 × 1,024"에 저장 벡터 수 × 1,024가 월 1회 더해진다. 사규집 청크 수가 수백 개라면 영향은 작다.
- **Workers 서브리퀘스트**: D1·KV 호출은 "Cloudflare services" 서브리퀘스트이며 Free에서 내부 서비스 한도는 1,000/호출, 외부 `fetch()`(Groq·OpenRouter 등)는 50/호출이다.

### 참고 (제3자 — 상태 근거로 쓰지 않음)

| 페이지 | 열람 결과 | 비고 |
|---|---|---|
| https://flarecalc.com/ | HTTP 200 | #7을 Cloudflare 공식 문서로 대체 |
| https://automationatlas.io/answers/supabase-free-tier-limits-2026/ | HTTP 200 | #46을 Supabase 공식 페이지로 대체 |
| https://www.developersdigest.tech/rate-limits/openrouter | HTTP 200 | #35는 OpenRouter 공식 문서로 확인 |

설계서 하단 Sources의 Vite·Hono(JSR)·Node.js EOL 링크는 §11 버전 정보라 이 문서 범위 밖이다(모두 HTTP 200 응답만 확인).

## 사람 작업

- [ ] Gemini API Free 한도 — AI Studio 콘솔에서 프로젝트별 RPM·TPM·RPD 캡처(공식 페이지에 표 없음) → `docs/evidence/captures/phase-0-gemini-limits.png`
- [ ] GitHub Actions 무료 조건 적용 확인 — 저장소 `hjryoo-ai/ga-commission-copilot`을 public으로 생성한 뒤 Settings → Billing에서 Actions 사용 0원/무료 상태 캡처 → `docs/evidence/captures/phase-0-gh-actions.png`. 같은 때 Actions Secrets `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID` 등록
- [ ] JDK 25 설치 — 로컬에는 Corretto 21만 있음. Phase 1 항목 4(projection-java) 전에 설치하고 `java -version` 출력 기록

## 설계서 반영 (v0.1.2·v0.1.3 대조, 2026-10-27)

설계서는 운영자가 v0.1.2로 교체했다. 아래는 Phase 0 반영 제안 12건과 v0.1.2 본문의 대조 결과이며, **설계서는 고치지 않는다**(보고만). 예산 수치(§6.2·§10.4 상한)는 유지.

**반영됨**

| 제안 | v0.1.2 위치 |
|---|---|
| 1 Workers 버스트 1,000/분 삭제·초과 시 Error 1027(fail open/closed) | §10.1 Workers 행, 변경 이력 |
| 3 Vectorize 인덱스당 2,000만, Free 초과 동작 "원문 미기재" | §10.1 Vectorize·Vectorize 한계 행 |
| 5 중 로그 요금 2026-12-01 전환(Free 0.5GB/일·7일 보존) | §10.1 "로그·트레이스" 행 신설 |
| 11 §7 버스트 문구 삭제·정적 자산 미집계 | §7 레이트 리밋 문단 |
| 12 테스트 패키지 `@cloudflare/vitest-plugin` | §11 표, §13 표 |

**남은 차이 처리 (v0.1.3 대조, 2026-10-27 운영자 결정)**

| # | 항목 | 처리 |
|---|---|---|
| 1 | §7 한도 초과 응답 1027 vs 429 | v0.1.3 반영됨(양쪽 처리) |
| 2 | 정적 자산 출처·`run_worker_first`·Workers Caching | v0.1.6 반영됨(§10.1·§10.2, 2026-10-30) |
| 3 | 내부 서비스 서브리퀘스트 1,000 | v0.1.6 반영됨(§10.1·§10.2, 2026-10-30) |
| 4 | Vectorize Free 인덱스 100·저장분 차원 | v0.1.6 반영됨(§10.1·§10.2, 2026-10-30) |
| 5 | Workers AI `kimi-k2.7-code` | v0.1.3 반영됨 |
| 6 | AI Gateway 로그 기준·갱신일·게이트웨이 수 | v0.1.6 반영됨(§10.1·§10.2, 2026-10-30) |
| 7 | Groq 무료 조건 출처 URL | 사람 작업(운영자 설계서 편집) — 근거 #34 |
| 8 | OpenRouter "모델별 아님" | v0.1.6 반영됨(§10.1·§10.2, 2026-10-30) |
| 9 | GitHub Actions 행 | 사람 작업(운영자 설계서 편집) — 근거 #41~#45 |
| 10 | Supabase·Vercel 출처 | v0.1.3 반영됨(Vercel URL). Supabase 공식 출처는 #46 |

### 설계서 v0.1.6에 합친 원문 인용 (2026-10-27 재열람, 따옴표 안은 원문 그대로)

**2. Workers 정적 자산** — §10.1 정적 자산 행의 출처 `workers/platform/limits/`에는 파일 수·크기 표만 있다.
- "Requests to static assets are free and unlimited. Requests to the Worker script (for example, in the case of SSR content) are billed according to Workers pricing." — https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ (갱신 2026-04-23)
- "**Important note for free tier users**: When using `run_worker_first`, requests matching the specified patterns will always invoke your Worker script. If you exceed your free tier request limits, these requests will receive a 429 (Too Many Requests) response instead of falling back to static asset serving." — 같은 URL
- "<sup>3</sup> Requests to static assets are free and unlimited." · "<sup>4</sup> When Workers Caching is enabled, requests served from the Worker's cache are billed at the same per-request rate as requests that invoke the Worker. This includes requests to static assets and worker-to-worker invocations." — https://developers.cloudflare.com/workers/platform/pricing/ (갱신 2026-10-02)

**3. Workers 내부 서비스 서브리퀘스트**
- "| Subrequests to internal services | 1,000 | Matches configured limit (default 10,000) |" (열: Free \| Paid) · "A subrequest is any request a Worker makes using the Fetch API or to Cloudflare services like R2, KV, or D1." — https://developers.cloudflare.com/workers/platform/limits/ (갱신 2026-10-12)

**4. Vectorize**
- "| Indexes per account | 50,000 (Workers Paid) / 100 (Free) |" — https://developers.cloudflare.com/vectorize/platform/limits/ (갱신 2026-08-05)
- "To calculate your potential usage, calculate the queried vector dimensions and the stored vector dimensions, and multiply by the unit price. The formula is defined as `((queried vectors + stored vectors) * dimensions * ($0.01 / 1,000,000)) + (stored vectors * dimensions * ($0.05 / 100,000,000))`" — https://developers.cloudflare.com/vectorize/platform/pricing/ (갱신 2026-04-21)

**6. AI Gateway**
- "Accounts that created their first gateway on or after September 24, 2026 store logs in Workers Logs and follow Workers Logs pricing and retention." · "Accounts that created a gateway before September 24, 2026 use Legacy Logs." — https://developers.cloudflare.com/ai-gateway/reference/pricing/ (페이지 표시 "Last updated Oct 15, 2026")
- "| Gateways free plan | 10 per account |" — https://developers.cloudflare.com/ai-gateway/reference/limits/ (페이지 표시 "Last updated Sep 24, 2026")

**8. OpenRouter** — 설계서 "계정 전체 기준, 모델별 아님"과 대조할 원문:
- "Making additional accounts or API keys will not affect your rate limits, as we govern capacity globally. We do however have different rate limits for different models, so you can share the load that way if you do run into issues." — https://openrouter.ai/docs/api_reference/limits (원문 `.md` 11행)
