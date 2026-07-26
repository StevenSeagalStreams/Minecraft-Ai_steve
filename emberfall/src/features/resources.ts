import { type Decimal, ZERO, maxD } from '../math/decimal';
import type { GameConfig } from '../types/defs';
import type { ResourceId } from '../types/ids';
import type { GameState, ResourceState } from '../types/state';

/** Reads a resource, or `undefined` if the id is not part of this save. */
export function getResource(state: GameState, id: ResourceId): ResourceState | undefined {
  return state.resources[id];
}

/** Current prestige-currency balance — the single source of truth for shards. */
export function getShards(state: GameState, config: GameConfig): Decimal {
  return state.resources[config.prestige.currency]?.amount ?? ZERO;
}

export function getAmount(state: GameState, id: ResourceId): Decimal {
  return state.resources[id]?.amount ?? ZERO;
}

function withResource(state: GameState, id: ResourceId, next: ResourceState): GameState {
  return { ...state, resources: { ...state.resources, [id]: next } };
}

/**
 * Credits production or a reward. Earnings feed both lifetime and per-run
 * totals — the latter is what prestige rewards are computed from.
 */
export function addResource(state: GameState, id: ResourceId, amount: Decimal): GameState {
  const resource = state.resources[id];
  if (resource === undefined || amount.lte(ZERO)) return state;
  return withResource(state, id, {
    ...resource,
    amount: resource.amount.add(amount),
    lifetimeEarned: resource.lifetimeEarned.add(amount),
    runEarned: resource.runEarned.add(amount),
  });
}

/**
 * Debits a purchase. Spending never touches lifetime totals, and the balance
 * is floored at zero so rounding can never produce a negative reserve.
 */
export function spendResource(state: GameState, id: ResourceId, amount: Decimal): GameState {
  const resource = state.resources[id];
  if (resource === undefined || amount.lte(ZERO)) return state;
  return withResource(state, id, {
    ...resource,
    amount: maxD(resource.amount.sub(amount), ZERO),
  });
}

export function canAfford(state: GameState, id: ResourceId, amount: Decimal): boolean {
  return getAmount(state, id).gte(amount);
}

export function unlockResource(state: GameState, id: ResourceId): GameState {
  const resource = state.resources[id];
  if (resource === undefined || resource.unlocked) return state;
  return withResource(state, id, { ...resource, unlocked: true });
}
