import { createInitialState } from '../features/gameState';
import { computeModifiers } from '../features/upgrades/modifiers';
import { D, type Decimal, type DecimalSource } from '../math/decimal';
import type { GameConfig } from '../types/defs';
import type { GeneratorId, ResourceId, UpgradeId } from '../types/ids';
import type { GameState } from '../types/state';
import { TEST_CONFIG, TEST_EPOCH } from './testConfig';

export function freshState(config: GameConfig = TEST_CONFIG, now = TEST_EPOCH): GameState {
  return createInitialState(config, now);
}

export function modifiersOf(state: GameState, config: GameConfig = TEST_CONFIG) {
  return computeModifiers(state, config);
}

/** Sets a resource balance directly, bypassing the earn path. */
export function withResource(
  state: GameState,
  id: ResourceId,
  amount: DecimalSource,
  lifetime: DecimalSource = amount,
): GameState {
  const resource = state.resources[id];
  if (resource === undefined) throw new Error(`unknown resource: ${id}`);
  return {
    ...state,
    resources: {
      ...state.resources,
      [id]: {
        ...resource,
        amount: D(amount),
        lifetimeEarned: D(lifetime),
        runEarned: D(lifetime),
      },
    },
  };
}

export function withGenerator(
  state: GameState,
  id: GeneratorId,
  owned: DecimalSource,
  unlocked = true,
): GameState {
  const generator = state.generators[id];
  if (generator === undefined) throw new Error(`unknown generator: ${id}`);
  return {
    ...state,
    generators: {
      ...state.generators,
      [id]: { ...generator, owned: D(owned), unlocked },
    },
  };
}

export function withUpgrade(
  state: GameState,
  id: UpgradeId,
  level: number,
  unlocked = true,
): GameState {
  const upgrade = state.upgrades[id];
  if (upgrade === undefined) throw new Error(`unknown upgrade: ${id}`);
  return {
    ...state,
    upgrades: { ...state.upgrades, [id]: { level, unlocked } },
  };
}

export function amountOf(state: GameState, id: ResourceId): Decimal {
  const resource = state.resources[id];
  if (resource === undefined) throw new Error(`unknown resource: ${id}`);
  return resource.amount;
}

export function ownedOf(state: GameState, id: GeneratorId): Decimal {
  const generator = state.generators[id];
  if (generator === undefined) throw new Error(`unknown generator: ${id}`);
  return generator.owned;
}

/** Serialises the parts of a state that engine determinism tests care about. */
export function snapshot(state: GameState): string {
  return JSON.stringify({
    resources: Object.fromEntries(
      Object.entries(state.resources).map(([id, resource]) => [
        id,
        [resource.amount.toString(), resource.lifetimeEarned.toString(), resource.unlocked],
      ]),
    ),
    generators: Object.fromEntries(
      Object.entries(state.generators).map(([id, generator]) => [
        id,
        [generator.owned.toString(), generator.unlocked],
      ]),
    ),
    upgrades: state.upgrades,
    prestige: {
      ...state.prestige,
      lifetimeShards: state.prestige.lifetimeShards.toString(),
      bestRunTotal: state.prestige.bestRunTotal.toString(),
    },
    story: state.story,
    stats: state.stats,
  });
}
