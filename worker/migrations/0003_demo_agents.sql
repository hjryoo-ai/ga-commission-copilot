-- =============================================================================================
-- 0003_demo_agents.sql — 설계서 v0.1.11 §5.1: stream_meta.line_count, demo_agents.
--
-- line_count: 적재기가 ⑤ 재검사에서 센 그 슬롯 earnings_line 행 수. /health는 stream_meta 1행만 읽는다(규약 3 예외 해소).
--   이미 적재된 행(원격 슬롯 a)은 아래 UPDATE로 채운다 — 빈 DB에서는 0행에 적용된다.
-- demo_agents: 스트림별 데모 설계사 3명(gen G3가 고른다, §4.1(a)). load:d1이 비활성 슬롯 적재 때 넣고 비울 때 지운다.
--   이미 적재된 스트림은 load:d1이 같은 해시로 다시 돌 때(활성 noop 경로) 빠진 행을 넣는다.
-- 추가만 한다 — 기존 표·행을 지우지 않는다.
-- =============================================================================================

ALTER TABLE stream_meta ADD COLUMN line_count INTEGER CHECK (line_count >= 0);

UPDATE stream_meta SET line_count = CASE slot
  WHEN 'a' THEN (SELECT COUNT(*) FROM earnings_line_a)
  ELSE (SELECT COUNT(*) FROM earnings_line_b)
END;

CREATE TABLE demo_agents (          -- 스트림별 데모 설계사 3명(설계서 v0.1.11 §4.1(a)·§5.1)
  stream_hash TEXT NOT NULL, demo_no INTEGER NOT NULL CHECK (demo_no IN (1, 2, 3)),
  tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL,
  scenario TEXT NOT NULL CHECK (scenario IN ('A1', 'A2', 'A3')), card_label TEXT NOT NULL,
  contract_count INTEGER NOT NULL CHECK (contract_count >= 0), basis TEXT NOT NULL CHECK (json_valid(basis)),
  PRIMARY KEY (stream_hash, demo_no), UNIQUE (stream_hash, agent_id)
) STRICT;
