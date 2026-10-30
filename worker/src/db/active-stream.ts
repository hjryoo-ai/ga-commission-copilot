// 활성 스트림·슬롯(설계서 v0.1.8 §5.1). 읽기 모델 8표는 <표>_a·<표>_b 두 벌이고, 어느 쪽을 읽을지는 stream_meta의 active=1 행이 정한다.
// 요청마다 그 한 행을 읽는다(부분 유일 인덱스 ux_stream_meta_active — 1행). isolate 안의 캐시는 stream_hash를 키로 한 파생 값만 둔다 —
// 슬롯 자체를 캐시하면 전환 뒤에도 옛 슬롯을 읽게 된다. Phase 2 ScopedQuery는 이 모듈로 표 이름을 정한다.

export type Slot = "a" | "b";

export interface ActiveStream {
  streamHash: string;
  slot: Slot;
}

/** 슬롯 표 이름. 슬롯은 DB CHECK(slot IN ('a','b'))를 거친 값이지만 SQL에 이어 붙이므로 여기서도 막는다. */
export function slotTable(table: string, slot: Slot): string {
  if (slot !== "a" && slot !== "b") throw new Error("invalid slot");
  return `${table}_${slot}`;
}

/** 활성 스트림. 첫 적재 전이면 null. stream_meta는 테넌트 열이 없는 전역 표다. */
export async function activeStream(db: D1Database): Promise<ActiveStream | null> {
  const row = await db.prepare("SELECT stream_hash, slot FROM stream_meta WHERE active = 1").first<{ stream_hash: string; slot: Slot }>();
  return row ? { streamHash: row.stream_hash, slot: row.slot } : null;
}

const perStream = new Map<string, unknown>();

/** isolate 단위 캐시: 같은 스트림이면 한 번만 계산한다. 키에 stream_hash가 들어가므로 전환되면 자연히 새로 계산된다. */
export async function cachedForStream<T>(stream: ActiveStream, key: string, load: () => Promise<T>): Promise<T> {
  const k = `${stream.streamHash}:${key}`;
  if (perStream.has(k)) return perStream.get(k) as T;
  const value = await load();
  perStream.set(k, value);
  return value;
}
