// 데모 테넌트 표시 값(설계서 v0.1.12 §7 — 상위 §5 tenant 예시값, 테넌트 표가 없어 상수). 읽기 API와 툴이 같이 쓴다.
export const DEMO_TENANT_CONFIG = { name: "데모GA", payoutDayRule: "NEXT_MONTH_D10", limitWarnBp: 8000, limitCritBp: 9500 } as const;
