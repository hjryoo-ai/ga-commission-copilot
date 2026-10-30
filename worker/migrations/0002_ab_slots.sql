-- =============================================================================================
-- 0002_ab_slots.sql — 설계서 v0.1.8 §5.1·§5.4: 읽기 모델 8표를 A/B 슬롯으로, stream_meta에 slot·부분 유일 인덱스.
--
-- 읽기 모델 8표(0001)는 비어 있는 채로 DROP하고 같은 DDL로 <표>_a·<표>_b를 만든다(열·CHECK·PK·UNIQUE는 0001 그대로 —
-- 표 이름과 인덱스 이름만 바꾼다: 인덱스는 <원래이름>_<slot>). 원래 이름의 표·뷰는 두지 않는다 — 활성 슬롯은 Worker 조회 계층이 고른다.
-- stream_meta(0001, 비어 있음)는 slot 열을 NOT NULL로 넣기 위해 다시 만든다.
-- 원격 적용 전 확인: 8표·stream_meta 행 수 0(docs/evidence/phase-1.md).
-- =============================================================================================
-- ─── 0001 읽기 모델 표 제거(인덱스는 함께 지워진다) ───────────────────────────────────────
DROP TABLE agent_profile;
DROP TABLE earnings_line;
DROP TABLE earnings_month;
DROP TABLE policy_limit;
DROP TABLE policy_limit_history;
DROP TABLE deferral_item;
DROP TABLE clawback_item;
DROP TABLE policy_flag;

-- ─── 슬롯 a ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE agent_profile_a (
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

CREATE TABLE earnings_line_a (
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
CREATE INDEX ix_line_agent_ym_a ON earnings_line_a (tenant_id, agent_id, close_ym);
CREATE INDEX ix_line_policy_a ON earnings_line_a (tenant_id, agent_id, policy_no);

CREATE TABLE earnings_month_a (
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

CREATE TABLE policy_limit_a (
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

CREATE TABLE policy_limit_history_a (             -- 원장 타임라인(전기·재산정). 키 = 이벤트 seq(V4, DD-5)
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

CREATE TABLE deferral_item_a (
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
CREATE INDEX ix_defer_agent_due_a ON deferral_item_a (tenant_id, agent_id, due_ym);

CREATE TABLE clawback_item_a (
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

CREATE TABLE policy_flag_a (
  tenant_id   TEXT NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 32 AND tenant_id GLOB '[A-Z0-9]*' AND tenant_id NOT GLOB '*[^A-Z0-9_]*'),
  policy_no   TEXT NOT NULL,
  agent_id    TEXT NOT NULL CHECK (length(agent_id) BETWEEN 1 AND 64 AND agent_id GLOB '[A-Za-z0-9]*' AND agent_id NOT GLOB '*[^A-Za-z0-9._-]*'),
  flag_type   TEXT NOT NULL CHECK (flag_type IN ('CANCELLED', 'LAPSED', 'OVERDUE', 'REDUCED')),
  occurred_on TEXT NOT NULL,                      -- DATE
  cleared_at  TEXT,                               -- TIMESTAMPTZ
  reason      TEXT CHECK (reason IN ('CANCEL', 'LAPSE', 'WITHDRAW', 'REDUCE', 'PAYMENT_OVERDUE')),
  PRIMARY KEY (tenant_id, policy_no, agent_id, flag_type)
) STRICT;


-- ─── 슬롯 b ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE agent_profile_b (
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

CREATE TABLE earnings_line_b (
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
CREATE INDEX ix_line_agent_ym_b ON earnings_line_b (tenant_id, agent_id, close_ym);
CREATE INDEX ix_line_policy_b ON earnings_line_b (tenant_id, agent_id, policy_no);

CREATE TABLE earnings_month_b (
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

CREATE TABLE policy_limit_b (
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

CREATE TABLE policy_limit_history_b (             -- 원장 타임라인(전기·재산정). 키 = 이벤트 seq(V4, DD-5)
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

CREATE TABLE deferral_item_b (
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
CREATE INDEX ix_defer_agent_due_b ON deferral_item_b (tenant_id, agent_id, due_ym);

CREATE TABLE clawback_item_b (
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

CREATE TABLE policy_flag_b (
  tenant_id   TEXT NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 32 AND tenant_id GLOB '[A-Z0-9]*' AND tenant_id NOT GLOB '*[^A-Z0-9_]*'),
  policy_no   TEXT NOT NULL,
  agent_id    TEXT NOT NULL CHECK (length(agent_id) BETWEEN 1 AND 64 AND agent_id GLOB '[A-Za-z0-9]*' AND agent_id NOT GLOB '*[^A-Za-z0-9._-]*'),
  flag_type   TEXT NOT NULL CHECK (flag_type IN ('CANCELLED', 'LAPSED', 'OVERDUE', 'REDUCED')),
  occurred_on TEXT NOT NULL,                      -- DATE
  cleared_at  TEXT,                               -- TIMESTAMPTZ
  reason      TEXT CHECK (reason IN ('CANCEL', 'LAPSE', 'WITHDRAW', 'REDUCE', 'PAYMENT_OVERDUE')),
  PRIMARY KEY (tenant_id, policy_no, agent_id, flag_type)
) STRICT;

-- ─── stream_meta(설계서 v0.1.8 §5.1) ─────────────────────────────────────────────────────────

DROP TABLE stream_meta;
CREATE TABLE stream_meta (          -- 적재된 스트림의 정체(슬롯마다 최대 1행)
  stream_hash TEXT NOT NULL PRIMARY KEY, generated_at TEXT NOT NULL, event_count INTEGER NOT NULL,
  plan_prompt_version TEXT NOT NULL, verified_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  slot TEXT NOT NULL CHECK (slot IN ('a', 'b'))
) STRICT;
CREATE UNIQUE INDEX ux_stream_meta_active ON stream_meta (active) WHERE active = 1;  -- 활성은 많아야 1행
CREATE UNIQUE INDEX ux_stream_meta_slot ON stream_meta (slot);                       -- 슬롯당 1행
