-- 설계서 v0.1.15 §5.1: explanation PK에 agent_id를 넣는다 — MONTH_DIFF subject_id는 close_ym이라 데모 설계사 3명의 같은 달이 v0.1 PK
-- (tenant_id, kind, subject_id, stream_hash, prompt_version)에서 충돌한다. 새 PK가 (tenant_id, agent_id, kind)로 시작하므로 ix_expl_agent는 없앤다.
-- 표는 이 마이그레이션 전까지 비어 있다(설명 적재는 Phase 3부터) — 옮길 행 없이 다시 만든다.
DROP TABLE explanation;
CREATE TABLE explanation (          -- Q1~Q3 사전 생성 설명
  tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL, kind TEXT NOT NULL,   -- LINE / LIMIT / MONTH_DIFF
  subject_id TEXT NOT NULL,                                     -- calc_id | ledger_id | close_ym
  stream_hash TEXT NOT NULL, prompt_version TEXT NOT NULL, model TEXT NOT NULL,
  text TEXT NOT NULL, cited_fields TEXT NOT NULL,               -- JSON array
  numbers_used TEXT NOT NULL, grounding_status TEXT NOT NULL,   -- PASS / FAIL / NONE
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, agent_id, kind, subject_id, stream_hash, prompt_version)
) STRICT;
