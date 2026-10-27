-- =============================================================================================
-- 0001_init.sql — Phase 0 D1 스키마. 설계서 v0.1.1 §5.1, 상위 설계서 v1.9 §5.
--
-- Ⅰ. 상위 읽기 모델 8개 — 상위 설계서 §5 DDL 블록(V1 + V4·V5 반영 최종 모양)을 컬럼명 그대로 옮겼다.
--    원문: ga-agent-portal/portal-infra/src/main/resources/db/migration/V1__init.sql, V4__projection.sql, V5__query_api.sql
-- Ⅱ. 본 설계서 §5.1 추가 테이블 8개 — DDL 그대로.
--
-- 변환 규칙(PostgreSQL → SQLite):
--   BIGINT → INTEGER, JSONB → TEXT(JSON), TIMESTAMPTZ → TEXT(ISO-8601), DATE → TEXT(YYYY-MM-DD), NUMERIC/decimalString → TEXT.
--   모든 표는 STRICT — INTEGER 열에 실수가 들어가면 거부된다(CLAUDE.md 규약 8, double 금지).
--   SQLite는 INTEGER가 아닌 PRIMARY KEY 열에 NULL을 허용하므로 PK 열에 NOT NULL을 명시한다(PostgreSQL PK와 같은 뜻).
--   정규식 CHECK(~)는 D1에 REGEXP가 없어 GLOB·length 조합으로 옮겼다(같은 문자 집합·길이·첫 글자 규칙).
--   닫힌 값 CHECK(IN)는 상위 V1·V4 값 목록 그대로. RLS·롤·GRANT는 옮기지 않는다(격리는 ScopedQuery + 아키텍처 테스트).
-- =============================================================================================

-- ─── Ⅰ. 상위 읽기 모델 ──────────────────────────────────────────────────────────────────────

CREATE TABLE agent_profile (
  tenant_id  TEXT NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 32 AND tenant_id GLOB '[A-Z0-9]*' AND tenant_id NOT GLOB '*[^A-Z0-9_]*'),
  agent_id   TEXT NOT NULL CHECK (length(agent_id) BETWEEN 1 AND 64 AND agent_id GLOB '[A-Za-z0-9]*' AND agent_id NOT GLOB '*[^A-Za-z0-9._-]*'),
  name       TEXT NOT NULL,
  grade      TEXT,
  org_path   TEXT NOT NULL,                       -- 엔진이 준 org_id 경로 그대로(예: /HQ1/BR03/TM07)
  role       TEXT,                                -- AGENT/TEAM_LEAD/BRANCH_HEAD/... (열린 값, NULL 허용 — V4)
  status     TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISMISSED')),
  valid_from TEXT NOT NULL,                       -- DATE
  last_seq   INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, agent_id)
) STRICT;

CREATE TABLE earnings_line (
  tenant_id           TEXT NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 32 AND tenant_id GLOB '[A-Z0-9]*' AND tenant_id NOT GLOB '*[^A-Z0-9_]*'),
  calc_id             TEXT NOT NULL,
  agent_id            TEXT NOT NULL CHECK (length(agent_id) BETWEEN 1 AND 64 AND agent_id GLOB '[A-Za-z0-9]*' AND agent_id NOT GLOB '*[^A-Za-z0-9._-]*'),
  policy_no           TEXT NOT NULL,
  product_key         TEXT,
  comm_type           TEXT NOT NULL,              -- FY_COMM/RENEWAL/INCENTIVE/OVERRIDE/DEFERRED/CLAWBACK/ADJUSTMENT/... (열린 값 — CHECK 없음)
  amount              INTEGER NOT NULL,           -- 한도 삭감 뒤 지급분(요청액 = amount + limit_cut_amt, I1)
  close_ym            TEXT NOT NULL CHECK (length(close_ym) = 6 AND close_ym NOT GLOB '*[^0-9]*' AND substr(close_ym, 5, 2) BETWEEN '01' AND '12'),
  reversal_of_calc_id TEXT,
  limit_cut_amt       INTEGER NOT NULL DEFAULT 0,
  limit_cut_policy    TEXT,
  basis               TEXT NOT NULL,              -- JSON. rate·payoutRate는 불투명 소수 문자열(표시 전용)
  policy_summary      TEXT NOT NULL,              -- JSON
  source_seq          INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, calc_id)
) STRICT;
CREATE INDEX ix_line_agent_ym ON earnings_line (tenant_id, agent_id, close_ym);
CREATE INDEX ix_line_policy   ON earnings_line (tenant_id, agent_id, policy_no);

CREATE TABLE earnings_month (
  tenant_id          TEXT NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 32 AND tenant_id GLOB '[A-Z0-9]*' AND tenant_id NOT GLOB '*[^A-Z0-9_]*'),
  agent_id           TEXT NOT NULL CHECK (length(agent_id) BETWEEN 1 AND 64 AND agent_id GLOB '[A-Za-z0-9]*' AND agent_id NOT GLOB '*[^A-Za-z0-9._-]*'),
  close_ym           TEXT NOT NULL CHECK (length(close_ym) = 6 AND close_ym NOT GLOB '*[^0-9]*' AND substr(close_ym, 5, 2) BETWEEN '01' AND '12'),
  gross              INTEGER NOT NULL DEFAULT 0,  -- 포털 합산: Σ 라인(comm_type ∉ {CLAWBACK, ADJUSTMENT})
  clawback_offset    INTEGER NOT NULL DEFAULT 0,  -- 포털 합산: Σ CLAWBACK 라인(≤ 0)
  adjustment         INTEGER NOT NULL DEFAULT 0,  -- 포털 합산: Σ ADJUSTMENT 라인
  withholding_tax    INTEGER,                     -- 엔진 명세 스냅샷에서만(NULL = 아직 없음)
  net                INTEGER,                     -- 엔진 명세 스냅샷에서만
  status             TEXT NOT NULL CHECK (status IN ('PROVISIONAL', 'ESTIMATED', 'CONFIRMED', 'PAID')),
  data_status        TEXT NOT NULL DEFAULT 'OK' CHECK (data_status IN ('OK', 'DRIFT', 'REBUILDING')),
  estimate_as_of     TEXT,                        -- TIMESTAMPTZ
  estimate_basis_seq INTEGER,
  confirmed_at       TEXT,                        -- TIMESTAMPTZ
  paid_at            TEXT,                        -- TIMESTAMPTZ
  paid_amount        INTEGER,
  receivable_offset  INTEGER,                     -- V4: PayoutCompleted 지급 런 확정값(엔진 값)
  carried_receivable INTEGER,
  payable            INTEGER,
  run_seq            INTEGER,
  net_basis          TEXT CHECK (net_basis IN ('ESTIMATE', 'CONFIRM', 'PAYOUT')),
  last_seq           INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, agent_id, close_ym)
) STRICT;

CREATE TABLE policy_limit (
  tenant_id        TEXT NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 32 AND tenant_id GLOB '[A-Z0-9]*' AND tenant_id NOT GLOB '*[^A-Z0-9_]*'),
  ledger_id        TEXT NOT NULL,
  agent_id         TEXT NOT NULL CHECK (length(agent_id) BETWEEN 1 AND 64 AND agent_id GLOB '[A-Za-z0-9]*' AND agent_id NOT GLOB '*[^A-Za-z0-9._-]*'),
  policy_no        TEXT NOT NULL,
  contract_date    TEXT NOT NULL,                 -- DATE
  fy_start         TEXT NOT NULL,                 -- DATE
  fy_end           TEXT NOT NULL,                 -- DATE
  monthly_premium  INTEGER NOT NULL,
  limit_multiple   TEXT NOT NULL                  -- 표시 전용 decimalString 원문(곱하지 않는다, V5)
                   CHECK (limit_multiple GLOB '[0-9]*' AND limit_multiple NOT GLOB '*[^0-9.]*' AND limit_multiple NOT GLOB '*.*.*' AND limit_multiple NOT GLOB '*.'),
  limit_amount     INTEGER NOT NULL,
  accum_paid       INTEGER NOT NULL DEFAULT 0,    -- 엔진 accumAfter 그대로(포털 합산 금지)
  cut_total        INTEGER NOT NULL DEFAULT 0,
  deferred_total   INTEGER NOT NULL DEFAULT 0,
  last_posting_seq INTEGER NOT NULL DEFAULT 0,
  rule_version_id  TEXT NOT NULL,
  PRIMARY KEY (tenant_id, ledger_id),
  UNIQUE (tenant_id, policy_no, agent_id)
) STRICT;

CREATE TABLE policy_limit_history (             -- 원장 타임라인(전기·재산정). 키 = 이벤트 seq(V4, DD-5)
  tenant_id   TEXT NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 32 AND tenant_id GLOB '[A-Z0-9]*' AND tenant_id NOT GLOB '*[^A-Z0-9_]*'),
  ledger_id   TEXT NOT NULL,
  source_seq  INTEGER NOT NULL,
  posting_seq INTEGER,                            -- REBASE는 전기 순번이 없을 수 있다
  kind        TEXT NOT NULL CHECK (kind IN ('POST', 'REBASE')),
  calc_id     TEXT,
  amount      INTEGER,
  accum_after INTEGER,
  limit_after INTEGER,
  reason      TEXT,
  occurred_at TEXT,                               -- TIMESTAMPTZ
  PRIMARY KEY (tenant_id, ledger_id, source_seq)
) STRICT;

CREATE TABLE deferral_item (
  tenant_id        TEXT NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 32 AND tenant_id GLOB '[A-Z0-9]*' AND tenant_id NOT GLOB '*[^A-Z0-9_]*'),
  schedule_id      TEXT NOT NULL,
  agent_id         TEXT NOT NULL CHECK (length(agent_id) BETWEEN 1 AND 64 AND agent_id GLOB '[A-Za-z0-9]*' AND agent_id NOT GLOB '*[^A-Za-z0-9._-]*'),
  policy_no        TEXT NOT NULL,
  source_calc_id   TEXT NOT NULL,
  due_ym           TEXT NOT NULL CHECK (length(due_ym) = 6 AND due_ym NOT GLOB '*[^0-9]*' AND substr(due_ym, 5, 2) BETWEEN '01' AND '12'),
  amount           INTEGER NOT NULL,
  pay_condition    TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('SCHEDULED', 'RELEASED', 'HELD', 'CANCELLED')),
  reason           TEXT NOT NULL CHECK (reason IN ('CURVE', 'LIMIT_DEFER')),
  curve_version_id TEXT NOT NULL,
  status_reason    TEXT CHECK (status_reason IN ('DUE_RELEASED', 'POLICY_NOT_INFORCE', 'POLICY_TERMINATED', 'SOURCE_REVERSED')),
  last_seq         INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, schedule_id)
) STRICT;
CREATE INDEX ix_defer_agent_due ON deferral_item (tenant_id, agent_id, due_ym);

CREATE TABLE clawback_item (
  tenant_id      TEXT NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 32 AND tenant_id GLOB '[A-Z0-9]*' AND tenant_id NOT GLOB '*[^A-Z0-9_]*'),
  receivable_id  TEXT NOT NULL,
  agent_id       TEXT NOT NULL CHECK (length(agent_id) BETWEEN 1 AND 64 AND agent_id GLOB '[A-Za-z0-9]*' AND agent_id NOT GLOB '*[^A-Za-z0-9._-]*'),
  origin_calc_id TEXT NOT NULL,
  amount         INTEGER NOT NULL,
  remaining      INTEGER NOT NULL,
  last_seq       INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('OPEN', 'OFFSET', 'CLOSED', 'WRITTEN_OFF')),
  PRIMARY KEY (tenant_id, receivable_id)
) STRICT;

CREATE TABLE policy_flag (
  tenant_id   TEXT NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 32 AND tenant_id GLOB '[A-Z0-9]*' AND tenant_id NOT GLOB '*[^A-Z0-9_]*'),
  policy_no   TEXT NOT NULL,
  agent_id    TEXT NOT NULL CHECK (length(agent_id) BETWEEN 1 AND 64 AND agent_id GLOB '[A-Za-z0-9]*' AND agent_id NOT GLOB '*[^A-Za-z0-9._-]*'),
  flag_type   TEXT NOT NULL CHECK (flag_type IN ('CANCELLED', 'LAPSED', 'OVERDUE', 'REDUCED')),
  occurred_on TEXT NOT NULL,                      -- DATE
  cleared_at  TEXT,                               -- TIMESTAMPTZ
  reason      TEXT CHECK (reason IN ('CANCEL', 'LAPSE', 'WITHDRAW', 'REDUCE', 'PAYMENT_OVERDUE')),
  PRIMARY KEY (tenant_id, policy_no, agent_id, flag_type)
) STRICT;

-- ─── Ⅱ. 설계서 §5.1 추가 테이블 ─────────────────────────────────────────────────────────────

CREATE TABLE stream_meta (          -- 현재 적재된 스트림의 정체
  stream_hash TEXT NOT NULL PRIMARY KEY, generated_at TEXT NOT NULL, event_count INTEGER NOT NULL,
  plan_prompt_version TEXT NOT NULL, verified_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE explanation (          -- Q1~Q3 사전 생성 설명
  tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL, kind TEXT NOT NULL,   -- LINE / LIMIT / MONTH_DIFF
  subject_id TEXT NOT NULL,                                     -- calc_id | ledger_id | close_ym
  stream_hash TEXT NOT NULL, prompt_version TEXT NOT NULL, model TEXT NOT NULL,
  text TEXT NOT NULL, cited_fields TEXT NOT NULL,               -- JSON array
  numbers_used TEXT NOT NULL, grounding_status TEXT NOT NULL,   -- PASS / FAIL / NONE
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, kind, subject_id, stream_hash, prompt_version)
) STRICT;
CREATE INDEX ix_expl_agent ON explanation (tenant_id, agent_id, kind);

CREATE TABLE rulebook_chunk (       -- 사규집 원문 (Vectorize에는 벡터+메타만)
  chunk_id TEXT NOT NULL PRIMARY KEY, article TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  visibility TEXT NOT NULL,         -- agent / internal
  version TEXT NOT NULL, token_count INTEGER NOT NULL
) STRICT;

CREATE TABLE sim_stub (             -- 데모 모드 시뮬레이션 고정 응답 (상위 설계서 부록 B)
  tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL, policy_no TEXT NOT NULL, kind TEXT NOT NULL,  -- POLICY_EVENT
  response TEXT NOT NULL,           -- JSON, 상위 설계서 §4.3 policy-event 응답 구조
  rule_snapshot_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, policy_no, kind)
) STRICT;

CREATE TABLE answer_log (           -- 런타임 답변 전건 (거부 포함)
  answer_id TEXT NOT NULL PRIMARY KEY, tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL,
  question TEXT NOT NULL, normalized_question TEXT NOT NULL,
  stream_hash TEXT NOT NULL, prompt_version TEXT NOT NULL,
  provider TEXT NOT NULL, model TEXT NOT NULL, fallback_depth INTEGER NOT NULL,  -- 0=1순위
  retrieved_chunks TEXT NOT NULL,   -- JSON [chunk_id, score]
  tool_calls TEXT NOT NULL,         -- JSON [{tool, args, resultHash}]
  answer TEXT, numbers_used TEXT, citations TEXT,
  refused INTEGER NOT NULL, refuse_reason TEXT,
  grounding_status TEXT NOT NULL, latency_ms INTEGER NOT NULL, cache_hit INTEGER NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX ix_ans_created ON answer_log (created_at);

CREATE TABLE budget_counter (       -- D-6: 예산은 D1
  scope TEXT NOT NULL, day TEXT NOT NULL,  -- scope = 'global' | 'ip:<hash>' | 'provider:groq' ...
  used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (scope, day)
) STRICT;

CREATE TABLE eval_run (
  run_id TEXT NOT NULL PRIMARY KEY, started_at TEXT NOT NULL, trigger TEXT NOT NULL,  -- weekly / pr:<n> / manual
  prompt_versions TEXT NOT NULL,    -- JSON {explain_line: 'v3', answer: 'v5', ...}
  stream_hash TEXT NOT NULL, model TEXT NOT NULL,
  total INTEGER, passed INTEGER, grounding_pass_rate REAL, refusal_accuracy REAL,
  tool_accuracy REAL, mean_latency_ms INTEGER
) STRICT;
CREATE TABLE eval_case_result (
  run_id TEXT NOT NULL, case_id TEXT NOT NULL, passed INTEGER NOT NULL, expected TEXT NOT NULL, actual TEXT NOT NULL,
  failure_kind TEXT,                -- GROUNDING / REFUSAL / TOOL / CONTENT
  PRIMARY KEY (run_id, case_id)
) STRICT;
