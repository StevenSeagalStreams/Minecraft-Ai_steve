import { create } from 'zustand';
import { type PersistStorage, persist } from 'zustand/middleware';
import { GAME_CONFIG } from '../data/config';
import { advance } from '../engine/advance';
import type { OfflineResult } from '../engine/offline';
import { createInitialState } from '../features/gameState';
import { manualGather } from '../features/idle/gather';
import { BUY_MAX, purchaseGenerator, setAutomationEnabled } from '../features/idle/generators';
import { ascend } from '../features/prestige/prestige';
import { dismissActiveNode, resolveChoice } from '../features/story/story';
import { computeModifiers } from '../features/upgrades/modifiers';
import { purchaseUpgrade } from '../features/upgrades/purchase';
import type { Decimal } from '../math/decimal';
import type { GeneratorId, ResourceId, StoryChoiceId, UpgradeId } from '../types/ids';
import type { SerializedGameState } from '../types/save';
import type { GameState } from '../types/state';
import { CURRENT_SAVE_VERSION, migrateSave } from './migrations';
import { createThrottledStorage, mmkvStorage } from './mmkvStorage';
import { deserializeGameState, serializeGameState } from './serialization';

const config = GAME_CONFIG;

export interface OfflineSummary {
  readonly creditedMs: number;
  readonly discardedMs: number;
  readonly efficiency: number;
  readonly gains: ReadonlyMap<ResourceId, Decimal>;
}

export interface GameStore {
  readonly game: GameState;
  readonly hydrated: boolean;
  /** Set when a returning player has offline gains they have not seen yet. */
  readonly pendingOffline: OfflineSummary | null;
  /** UI preference: how many units the buy buttons purchase at once. */
  readonly bulkBuy: number;
  /** Debug telemetry: milliseconds integrated by the most recent advance. */
  readonly lastTickDeltaMs: number;
  /** Debug telemetry: wall-clock stamp of the last committed save, if any. */
  readonly lastSavedAt: number | null;

  advanceTo(now?: number): void;
  gather(): void;
  buyGenerator(id: GeneratorId, count?: number): void;
  buyUpgrade(id: UpgradeId): void;
  toggleAutomation(id: GeneratorId, enabled: boolean): void;
  chooseStoryOption(choice: StoryChoiceId, now?: number): void;
  dismissStory(): void;
  ascendNow(now?: number): void;
  setBulkBuy(option: number): void;
  acknowledgeOffline(): void;
  hardReset(now?: number): void;
  saveNow(): void;
}

const throttled = createThrottledStorage(mmkvStorage, config.persistence.saveIntervalMs);

function toSummary(offline: OfflineResult): OfflineSummary {
  return {
    creditedMs: offline.creditedMs,
    discardedMs: offline.discardedMs,
    efficiency: offline.efficiency,
    gains: offline.gains,
  };
}

/**
 * Storage adapter in the game's own save format.
 *
 * zustand's `StorageValue` is `{ state, version }`; writing it out alongside a
 * timestamp produces exactly the `SaveFile` shape, so there is one on-disk
 * format rather than a zustand envelope wrapped around a game envelope.
 * Migration happens on read, before the payload reaches `merge`.
 */
const saveStorage: PersistStorage<SerializedGameState> = {
  getItem: (name) => {
    const raw = throttled.read(name);
    if (raw === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;

    const candidate = parsed as { version?: unknown; state?: unknown };
    const version = typeof candidate.version === 'number' ? candidate.version : 0;
    const migration = migrateSave(candidate.state, version);
    if (migration.incomplete) return null;

    // `merge` revives the Decimals; the cast only asserts the envelope shape.
    return { state: migration.state as SerializedGameState, version: migration.toVersion };
  },

  setItem: (name, value) => {
    throttled.write(
      name,
      JSON.stringify({
        version: value.version ?? CURRENT_SAVE_VERSION,
        savedAt: Date.now(),
        state: value.state,
      }),
    );
  },

  removeItem: (name) => {
    throttled.clear(name);
  },
};

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      game: createInitialState(config, Date.now()),
      hydrated: false,
      pendingOffline: null,
      bulkBuy: config.bulkBuy.defaultOption,
      lastTickDeltaMs: 0,
      lastSavedAt: null,

      advanceTo: (now = Date.now()) => {
        const result = advance(get().game, now, config);
        set({
          game: result.state,
          lastTickDeltaMs: result.tick?.elapsedMs ?? result.offline?.creditedMs ?? 0,
          lastSavedAt: throttled.lastWriteAt(),
          pendingOffline:
            result.offline !== null && result.offline.applied
              ? toSummary(result.offline)
              : get().pendingOffline,
        });
      },

      gather: () => {
        const { game } = get();
        set({ game: manualGather(game, config, computeModifiers(game, config)).state });
      },

      buyGenerator: (id, count) => {
        const { game } = get();
        const requested = count ?? get().bulkBuy;
        const modifiers = computeModifiers(game, config);
        const result = purchaseGenerator(game, config, id, requested, modifiers);
        if (result.state !== game) set({ game: result.state });
      },

      buyUpgrade: (id) => {
        const { game } = get();
        const result = purchaseUpgrade(game, config, id, computeModifiers(game, config));
        if (result.purchased) set({ game: result.state });
      },

      toggleAutomation: (id, enabled) => {
        set({ game: setAutomationEnabled(get().game, id, enabled) });
      },

      chooseStoryOption: (choice, now = Date.now()) => {
        set({ game: resolveChoice(get().game, config, choice, now) });
      },

      dismissStory: () => {
        set({ game: dismissActiveNode(get().game) });
      },

      ascendNow: (now = Date.now()) => {
        const { game } = get();
        const result = ascend(game, config, computeModifiers(game, config), now);
        if (result.gained.gt(0)) set({ game: result.state });
      },

      setBulkBuy: (option) => {
        set({ bulkBuy: option });
      },

      acknowledgeOffline: () => {
        set({ pendingOffline: null });
      },

      hardReset: (now = Date.now()) => {
        set({ game: createInitialState(config, now), pendingOffline: null });
        throttled.clear(config.persistence.storageKey);
      },

      saveNow: () => {
        throttled.flush();
      },
    }),
    {
      name: config.persistence.storageKey,
      version: CURRENT_SAVE_VERSION,
      storage: saveStorage,
      // Only the game state is persisted; `hydrated`, `pendingOffline` and the
      // bulk-buy preference are session concerns.
      partialize: (store) => serializeGameState(store.game),
      /**
       * Persisted values are strings, never `Decimal`. Reviving here — instead
       * of letting zustand shallow-merge — is what keeps a raw serialized state
       * from ever reaching the engine.
       */
      merge: (persisted, current) => ({
        ...current,
        game: deserializeGameState(persisted, config, Date.now()),
      }),
      onRehydrateStorage: () => (store) => {
        store?.advanceTo(Date.now());
        useGameStore.setState({ hydrated: true });
      },
    },
  ),
);

/** Flushes any pending save. Call before the app loses focus. */
export function flushSave(): void {
  throttled.flush();
}

export { config as gameConfig };
