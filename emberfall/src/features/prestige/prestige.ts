import { D, type Decimal, ZERO, maxD } from '../../math/decimal';
import type { GameConfig } from '../../types/defs';
import type { GeneratorId, ResourceId, UpgradeId } from '../../types/ids';
import type { GameState, GeneratorState, ResourceState, UpgradeState } from '../../types/state';
import { createInitialState } from '../gameState';
import { getRegistry } from '../registry';
import { applyUnlocks } from '../unlocks';
import type { Modifiers } from '../upgrades/modifiers';

/**
 * Shards awarded for ascending right now:
 *
 *   gain = gainMultiplier * prestigeGainModifier * (runTotal / divisor) ^ exponent
 *
 * Below the requirement the reward is zero, which is what keeps `canAscend`
 * and the reward formula from disagreeing.
 */
export function computeShardGain(
  state: GameState,
  config: GameConfig,
  modifiers: Modifiers,
): Decimal {
  const { prestige } = config;
  const runTotal = state.resources[prestige.sourceResource]?.runEarned ?? ZERO;
  if (runTotal.lt(D(prestige.requirement))) return ZERO;

  const base = runTotal.div(D(prestige.divisor)).pow(prestige.exponent);
  return base.mul(D(prestige.gainMultiplier)).mul(modifiers.prestigeGain).floor();
}

export function canAscend(state: GameState, config: GameConfig, modifiers: Modifiers): boolean {
  return computeShardGain(state, config, modifiers).gt(ZERO);
}

/** Run progress toward the ascension requirement, clamped to 0..1. */
export function ascensionProgress(state: GameState, config: GameConfig): number {
  const runTotal = state.resources[config.prestige.sourceResource]?.runEarned ?? ZERO;
  const requirement = D(config.prestige.requirement);
  if (requirement.lte(ZERO)) return 1;
  const ratio = runTotal.div(requirement).toNumber();
  return Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 1;
}

export interface AscensionResult {
  readonly state: GameState;
  readonly gained: Decimal;
}

/**
 * Ascends: the world resets, the memory of it does not.
 *
 * Carried across: persistent resources (shards), persistent upgrade levels,
 * lifetime totals, story flags and choice history. Cleared: current amounts,
 * generators, non-persistent upgrades, per-run totals, and any story node
 * flagged `repeatAfterPrestige`.
 */
export function ascend(
  state: GameState,
  config: GameConfig,
  modifiers: Modifiers,
  atMs: number,
): AscensionResult {
  const gained = computeShardGain(state, config, modifiers);
  if (gained.lte(ZERO)) return { state, gained: ZERO };

  const fresh = createInitialState(config, atMs);
  const registry = getRegistry(config);
  const currency = config.prestige.currency;
  const runTotal = state.resources[config.prestige.sourceResource]?.runEarned ?? ZERO;

  const resources: Record<ResourceId, ResourceState> = {};
  for (const def of config.resources) {
    const previous = state.resources[def.id];
    const base = fresh.resources[def.id];
    if (base === undefined) continue;
    if (previous === undefined) {
      resources[def.id] = base;
      continue;
    }

    const carried = def.persistent ? previous.amount : base.amount;
    const awarded = def.id === currency ? carried.add(gained) : carried;
    resources[def.id] = {
      amount: awarded,
      // Lifetime totals span every run; the shard award counts toward them.
      lifetimeEarned:
        def.id === currency ? previous.lifetimeEarned.add(gained) : previous.lifetimeEarned,
      runEarned: def.persistent ? awarded : base.runEarned,
      unlocked: def.persistent ? previous.unlocked : base.unlocked,
    };
  }

  const generators: Record<GeneratorId, GeneratorState> = {};
  for (const def of config.generators) {
    const previous = state.generators[def.id];
    const base = fresh.generators[def.id];
    if (base === undefined) continue;
    generators[def.id] = {
      ...base,
      // Purchase totals and the player's autobuyer toggles are preferences and
      // statistics, not progress, so they survive.
      lifetimePurchased: previous?.lifetimePurchased ?? base.lifetimePurchased,
      automationEnabled: previous?.automationEnabled ?? base.automationEnabled,
    };
  }

  const upgrades: Record<UpgradeId, UpgradeState> = {};
  for (const def of config.upgrades) {
    const previous = state.upgrades[def.id];
    const base = fresh.upgrades[def.id];
    if (base === undefined) continue;
    upgrades[def.id] = def.persistent && previous !== undefined ? previous : base;
  }

  const seenNodes = state.story.seenNodes.filter(
    (id) => registry.story.get(id)?.repeatAfterPrestige !== true,
  );

  const next: GameState = {
    resources,
    generators,
    upgrades,
    prestige: {
      count: state.prestige.count + 1,
      lifetimeShards: state.prestige.lifetimeShards.add(gained),
      bestRunTotal: maxD(state.prestige.bestRunTotal, runTotal),
      lastAscensionAt: atMs,
    },
    story: {
      seenNodes,
      queue: [],
      activeNode: null,
      flags: state.story.flags,
      history: state.story.history,
    },
    stats: {
      ...state.stats,
      runPlayTimeMs: 0,
      lastOfflineMs: 0,
    },
    lastTickAt: atMs,
  };

  return { state: applyUnlocks(next, config), gained };
}
