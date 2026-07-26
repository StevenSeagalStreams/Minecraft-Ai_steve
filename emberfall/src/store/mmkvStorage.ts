import { type MMKV, createMMKV } from 'react-native-mmkv';

/**
 * MMKV-backed storage for the save file.
 *
 * The instance is created lazily so importing this module — which anything
 * touching the store does — never triggers native initialisation before the
 * platform is ready.
 *
 * MMKV writes are atomic: a crash mid-write leaves the previous value intact
 * rather than a truncated one, which is the property a save file needs most.
 */
let instance: MMKV | null = null;

function storage(): MMKV {
  instance ??= createMMKV({ id: 'emberfall' });
  return instance;
}

export interface RawStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
  clear(key: string): void;
}

export const mmkvStorage: RawStorage = {
  read: (key) => storage().getString(key) ?? null,
  write: (key, value) => storage().set(key, value),
  clear: (key) => {
    storage().remove(key);
  },
};

/**
 * In-memory stand-in used on platforms without MMKV and in tests. Same
 * contract, no persistence.
 */
export function createMemoryStorage(): RawStorage {
  const map = new Map<string, string>();
  return {
    read: (key) => map.get(key) ?? null,
    write: (key, value) => {
      map.set(key, value);
    },
    clear: (key) => {
      map.delete(key);
    },
  };
}

export interface ThrottledStorage extends RawStorage {
  /** Writes any pending value immediately (call before backgrounding). */
  flush(): void;
  /** Drops a pending write without persisting it. */
  cancel(): void;
}

/**
 * Rate-limits writes.
 *
 * The engine ticks ~10x a second; serialising and persisting the whole save
 * that often is pure waste. Writes coalesce to at most one per interval, with
 * the newest pending value always winning, and `flush` forces the write when
 * the app is about to lose focus.
 */
export function createThrottledStorage(
  inner: RawStorage,
  intervalMs: number,
  now: () => number = Date.now,
): ThrottledStorage {
  let lastWriteAt = Number.NEGATIVE_INFINITY;
  let pending: { key: string; value: string } | null = null;

  const commit = (key: string, value: string): void => {
    inner.write(key, value);
    lastWriteAt = now();
    pending = null;
  };

  return {
    read: (key) => (pending?.key === key ? pending.value : inner.read(key)),
    write: (key, value) => {
      if (now() - lastWriteAt >= intervalMs) {
        commit(key, value);
      } else {
        pending = { key, value };
      }
    },
    clear: (key) => {
      pending = null;
      inner.clear(key);
    },
    flush: () => {
      if (pending !== null) commit(pending.key, pending.value);
    },
    cancel: () => {
      pending = null;
    },
  };
}
