import type {
  BulkBuyConfigDef,
  FormattingConfigDef,
  GameConfig,
  ManualGatherConfigDef,
  OfflineConfigDef,
  PersistenceConfigDef,
  PrestigeConfigDef,
  TimeConfigDef,
} from '../types/defs';
import { GENERATORS } from './generators';
import { RESOURCE_IDS, RESOURCES } from './resources';
import { STORY_NODES } from './story';
import { UPGRADES } from './upgrades';

export const PRESTIGE: PrestigeConfigDef = {
  currency: RESOURCE_IDS.shard,
  sourceResource: RESOURCE_IDS.ember,
  requirement: '1e9',
  divisor: '1e9',
  exponent: 0.5,
  gainMultiplier: '1',
  shardBonus: '0.5',
  shardBonusExponent: 0.9,
};

export const OFFLINE: OfflineConfigDef = {
  minElapsedMs: 5_000,
  /** 8 hours. */
  maxElapsedMs: 28_800_000,
  efficiency: 0.5,
  stepMs: 1_000,
  maxSteps: 2_000,
  automationEnabled: true,
};

export const TIME: TimeConfigDef = {
  /**
   * 4 Hz. Production is integrated from elapsed time, so the rate is identical
   * at any cadence — this only sets how often the UI re-renders and how often
   * autobuyers get a chance to fire.
   */
  tickIntervalMs: 250,
  maxTickMs: 5_000,
  maxBackwardDriftMs: 5_000,
  /**
   * Gaps beyond 5s are routed through offline catch-up rather than integrated
   * as one giant tick. `advance` falls back to a tick if the offline path
   * declines, so this value and `OFFLINE.minElapsedMs` can be tuned apart
   * without opening a window where elapsed time is dropped.
   */
  maxForwardDriftMs: 5_000,
};

export const MANUAL_GATHER: ManualGatherConfigDef = {
  resource: RESOURCE_IDS.ember,
  /** Base yield per tap, before the global production multiplier. */
  baseAmount: '1',
  /**
   * A tap is also worth this many seconds of current output, so tapping stays
   * marginally relevant early and gracefully becomes irrelevant later.
   */
  secondsOfProduction: 0.5,
};

export const FORMATTING: FormattingConfigDef = {
  notation: 'standard',
  plainBelow: '1e6',
  decimalPlaces: 2,
  smallDecimalPlaces: 2,
  suffixSeparator: ' ',
  groupSeparator: ',',
};

export const BULK_BUY: BulkBuyConfigDef = {
  options: [1, 10, 100, -1],
  maxOption: -1,
  defaultOption: 1,
};

export const PERSISTENCE: PersistenceConfigDef = {
  storageKey: 'emberfall.save.v1',
  saveIntervalMs: 10_000,
};

export const GAME_CONFIG: GameConfig = {
  resources: RESOURCES,
  generators: GENERATORS,
  upgrades: UPGRADES,
  story: STORY_NODES,
  prestige: PRESTIGE,
  offline: OFFLINE,
  time: TIME,
  formatting: FORMATTING,
  bulkBuy: BULK_BUY,
  manualGather: MANUAL_GATHER,
  persistence: PERSISTENCE,
};
