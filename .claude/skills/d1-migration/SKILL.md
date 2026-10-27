---
name: d1-migration
description: ga-commission-copilot의 D1(SQLite) 마이그레이션을 쓰거나 고칠 때의 규칙. 상위 저장소 ga-agent-portal의 PostgreSQL 읽기 모델 DDL을 SQLite로 옮기는 타입 변환, tenant_id·PK·인덱스 규약, CHECK 제약 변환, 번호 규칙, 로컬 적용·검증 명령. worker/migrations/** 를 만들거나 바꿀 때, 테이블·컬럼·인덱스를 추가할 때 로드한다.
---

# D1 마이그레이션 규칙

정본: 설계서 §5.1(추가 테이블 DDL), 상위 설계서 `../ga-agent-portal/docs/설계서.md` §5(읽기 모델). 상위 DDL 원문은 `../ga-agent-portal/portal-infra/src/main/resources/db/migration/V*.sql`이고, 설계서 §5의 DDL 블록이 V1 이후 변경(V4·V5 등)을 반영한 최종 모양이다. 둘이 다르면 설계서 §5 블록을 따른다.

## 파일

- 위치: `worker/migrations/NNNN_<snake_name>.sql` (`0001_init.sql`부터, 4자리). `wrangler.jsonc`의 D1 바인딩에 `"migrations_dir": "migrations"`.
- 이미 적용된 마이그레이션 파일은 **고치지 않는다**. 변경은 새 번호 파일로 한다(Phase 0 커밋 전에는 0001을 고쳐도 된다).
- 파일 머리 주석: 출처(설계서 § / 상위 설계서 § / 상위 V 파일), 변환 규칙 요약.

## 상위(PostgreSQL) → D1(SQLite) 변환

| PostgreSQL | SQLite | 비고 |
|---|---|---|
| `BIGINT` | `INTEGER` | 금액은 정수 원. REAL 금지(규약 8) |
| `JSONB` | `TEXT` | JSON 문자열. 필요하면 `CHECK (json_valid(col))` |
| `TIMESTAMPTZ` | `TEXT` | ISO-8601 문자열(오프셋 포함) |
| `DATE` | `TEXT` | `YYYY-MM-DD` |
| `NUMERIC(p,s)` | `TEXT` | 불투명 소수 문자열(표시 전용, 곱하지 않는다) |
| `UUID` | `TEXT` | |
| `BIGSERIAL` | `INTEGER` | 필요 시 `AUTOINCREMENT` 없이 rowid |
| `CHAR(64)` | `TEXT` | |
| 정규식 `CHECK (x ~ '…')` | `GLOB` 또는 `length()` 조합 | D1에는 REGEXP가 없다. `yyyyMM`은 `GLOB '[0-9][0-9][0-9][0-9][01][0-9]'` |
| 닫힌 값 `CHECK (x IN (…))` | 그대로 | 값 목록은 상위 설계서 §5 주석·V 파일과 같게 |
| `DEFAULT now()` | 쓰지 않음 | 적재기가 값을 넣는다(결정론) |

- **컬럼명은 그대로**(설계서 §5.1). 이름을 바꾸거나 컬럼을 빼지 않는다.
- `tenant_id`는 첫 컬럼, PK·UNIQUE·인덱스의 첫 열. 데모 테넌트가 하나여도 유지한다(ScopedQuery 규약).
- 상위 인덱스는 이름까지 그대로 옮긴다(`ix_line_agent_ym` 등).
- RLS(`V2__rls.sql`)·롤·`GRANT`는 옮기지 않는다 — D1에는 없고, 격리는 `ScopedQuery` + 아키텍처 테스트가 맡는다.
- 상위 8개 읽기 모델 테이블: `agent_profile`, `earnings_line`, `earnings_month`, `policy_limit`, `policy_limit_history`, `deferral_item`, `clawback_item`, `policy_flag`. 그 밖의 상위 테이블(`tenant`, `notification`, `inquiry`, `ingest_*`, `recon_result`, `audit_access`, `simulation_log`, `identity_link`)은 설계서가 요구할 때만 옮긴다.

## 규약 연결

- `budget_counter`는 D1에만(규약 5). 갱신은 `UPDATE budget_counter SET used = used + 1 WHERE scope = ? AND day = ? AND used < ?` 한 문장.
- 마감월 불변(규약 9)은 스키마가 아니라 적재기·코드 경로 부재로 지킨다. 트리거로 막고 싶다면 설계서에 먼저 적는다.
- 풀스캔 금지(설계서 §5.3): 새 조회 패턴마다 인덱스가 있는지 `EXPLAIN QUERY PLAN`으로 확인한다.

## 적용·검증

```bash
cd worker
pnpm wrangler d1 migrations apply copilot --local
pnpm wrangler d1 execute copilot --local --command \
  "SELECT type, name FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY type, name"
```

테이블 수·인덱스 수를 기대값과 대조해 증거 문서에 붙인다. vitest-pool-workers 테스트에서는 `readD1Migrations()` + `applyD1Migrations()`로 같은 파일을 적용해 런타임 테스트와 스키마를 일치시킨다.

원격 적용(`--remote`)은 배포 단계에서만, 사용자 확인 후 실행한다.
