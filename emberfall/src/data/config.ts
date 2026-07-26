import type {
  BulkBuyConfigDef,
  FormattingConfigDef,
  GameConfig,
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
  minElapsedMs: 30_000,
  maxElapsedMs: 43_200_000,
  efficiency: 0.5,
  stepMs: 1_000,
  maxSteps: 2_000,
  automationEnabled: true,
};

export const TIME: TimeConfigDef = {
  tickIntervalMs: 100,
  maxTickMs: 5_000,
  maxBackwardDriftMs: 5_000,
  /** Matches `OFFLINE.minElapsedMs`: longer gaps go through offline catch-up. */
  maxForwardDriftMs: 30_000,
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
  persistence: PERSISTENCE,
};
