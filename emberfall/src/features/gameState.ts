import { D, ZERO } from '../math/decimal';
import type { GameConfig } from '../types/defs';
import type { GeneratorId, ResourceId, UpgradeId } from '../types/ids';
import type {
  GameState,
  GeneratorState,
  ResourceState,
  StatsState,
  UpgradeState,
} from '../types/state';
import { applyUnlocks } from './unlocks';

/**
 * Builds a pristine save. `now` is supplied by the caller so state creation
 * stays deterministic — nothing in this module reads the clock.
 */
export function createInitialState(config: GameConfig, now: number): GameState {
  const resources: Record<ResourceId, ResourceState> = {};
  for (const def of config.resources) {
    const starting = D(def.startingAmount);
    resources[def.id] = {
      amount: starting,
      lifetimeEarned: starting,
      runEarned: starting,
      unlocked: def.unlockedAtStart,
    };
  }

  const generators: Record<GeneratorId, GeneratorState> = {};
  for (const def of config.generators) {
    generators[def.id] = {
      owned: ZERO,
      lifetimePurchased: ZERO,
      unlocked: def.unlockedAtStart,
      // Autobuyers default to on; they do nothing until unlocked by an upgrade.
      automationEnabled: true,
    };
  }

  const upgrades: Record<UpgradeId, UpgradeState> = {};
  for (const def of config.upgrades) {
    upgrades[def.id] = { level: 0, unlocked: false };
  }

  const stats: StatsState = {
    totalPlayTimeMs: 0,
    runPlayTimeMs: 0,
    totalTicks: 0,
    lastOfflineMs: 0,
    createdAt: now,
  };

  const state: GameState = {
    resources,
    generators,
    upgrades,
    prestige: {
      count: 0,
      lifetimeShards: ZERO,
      bestRunTotal: ZERO,
      lastAscensionAt: now,
    },
    story: {
      seenNodes: [],
      queue: [],
      activeNode: null,
      flags: {},
      history: [],
    },
    stats,
    lastTickAt: now,
  };

  return applyUnlocks(state, config);
}
