# 골든 스트림 (포털 Phase 2 계획 ⑨, 승인 Q11)

한 줄에 Envelope 하나(머리 줄 없음 — 엔진 골든 파일과 같은 형식). 기대 뷰는 `../golden-views/<스트림 이름>/<표>.jsonl`.

| 파일 | 출처 | 내용 | 시험 |
|---|---|---|---|
| (계약) `contracts/events/v1/samples/a1/a1_portal_150000_e2.jsonl` | 엔진 `ga-commission-engine@b6b65df`(`e2` = `4680ee1`) E2 ⓪ 둘째 판, SHA-256 `e9a03d37c513e591e7623d95bce6bc49ef2269e3c1f1336d369be2cc1eeb751a` | A-1 정본 11건(계약 v1.4 — 첫 판 10건 + 202702 잠정 명세) — 이 디렉터리에 사본을 두지 않는다 | C1 |
| `engine-e1-cycle.jsonl` | 엔진 `ga-commission-engine@826b3e4`(`e1`) `commission-outbox/src/test/resources/outbox-golden/cycle_마감_지급_채권_정정.jsonl` 바이트 그대로, SHA-256 `407087437945683246a54f58610957919e7fc51e40cf112f819ae0164d1f64c6` | 19건: 원장 둘, 마감·지급, 음수 순액 채권화(OPEN → CLOSED), 정정 → 정정만 있는 달의 확정, 고정 시계(모든 `occurredAt` 같음) | C1·C5 반례 기반 |
| `a1-interleaved.jsonl` | A-1에서 | 순서 `1,2,4,3,5,6,7,8,9,10,11`(계산·전기·계산·전기), seq 1~11 다시 매김 | C3 |
| `a1-posted-first.jsonl` | A-1에서 | 순서 `1,4,5,2,3,6,7,8,10,9,11`(전기가 그 라인보다 먼저 — D-6 역전), seq 다시 매김 | C3·K2 |
| `engine-e2-estimate/estimate_cycle_0N_*.jsonl`(다섯) | 엔진 `ga-commission-engine@4680ee1`(`e2`) `commission-outbox/src/test/resources/outbox-golden/` 바이트 그대로 — SHA-256 `01_기본` `8dcdaff0…0a72c5`, `02_채권_상계` `cd188a12…68d810`, `03_정정_포함` `4f1d5e19…72b6`, `04_음수_순액_채권화` `9067d8bb…519f`, `05_분급_도래` `049e480a…a9cb`(전체 값은 `GoldenStreamsTest`) | 엔진 E2 C2 "예상 = 실제" 다섯 사례: 기본·앞 달 채권 상계(payable 567,000)·정정 포함·음수 순액의 채권화·마감이 넣는 도래 분급. **계약 아님**(시험 자원 — 계약 v1.4 N5) | C1·C6(`01` — 예상 → 확정(세후 유지) → 지급) |

`GoldenStreamsTest`가 A-1에서 위 규칙으로 다시 만들어 파일과 대조하고, 엔진 사본 일곱(A-1 둘째 판·E1 cycle·E2 잠정 명세 다섯)의 SHA-256을 고정한다. 손 스트림 `a1-estimated`는 v1.4에서 지웠다(엔진 `01_기본`이 같은 모양 — 계약 v1.4 N4). 정정 `reason`(엔진 자유 문자열 — 설계사·고객 값이 아니다)은
평문 스캔 대상이 아니다(승인 Q3).
