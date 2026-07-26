import { D, type Decimal, ONE, ZERO, minD } from '../../math/decimal';
import { bulkCost, maxAffordable } from '../../math/scaling';
import type { GameConfig } from '../../types/defs';
import type { GeneratorId, ResourceId } from '../../types/ids';
import type { GameState } from '../../types/state';
import { getRegistry } from '../registry';
import { getAmount, spendResource } from '../resources';
import { type Modifiers, costMultiplier } from '../upgrades/modifiers';

/** Sentinel `count` meaning "as many as the player can currently afford". */
export const BUY_MAX = -1;

export interface PurchaseQuote {
  readonly generator: GeneratorId;
  readonly resource: ResourceId;
  readonly count: Decimal;
  readonly cost: Decimal;
  readonly affordable: boolean;
}

/** Price of `count` more of a generator, including cost-reduction modifiers. */
export function quotePurchase(
  state: GameState,
  config: GameConfig,
  generator: GeneratorId,
  requestedCount: number,
  modifiers: Modifiers,
): PurchaseQuote | null {
  const def = getRegistry(config).generators.get(generator);
  const generatorState = state.generators[generator];
  if (def === undefined || generatorState === undefined) return null;

  const resource = def.cost.resource;
  const discount = costMultiplier(modifiers, generator);
  const budget = getAmount(state, resource).div(discount);

  const count =
    requestedCount === BUY_MAX
      ? maxAffordable(def.cost, generatorState.owned, budget)
      : D(Math.max(0, Math.floor(requestedCount)));

  if (count.lte(ZERO)) {
    return { generator, resource, count: ZERO, cost: ZERO, affordable: false };
  }

  const cost = bulkCost(def.cost, generatorState.owned, count).mul(discount);
  return {
    generator,
    resource,
    count,
    cost,
    affordable: getAmount(state, resource).gte(cost),
  };
}

export interface PurchaseResult {
  readonly state: GameState;
  readonly purchased: Decimal;
  readonly spent: Decimal;
}

/**
 * Buys up to `requestedCount` generators, clamping to what is affordable so a
 * stale UI quote can never overdraw the player's balance.
 */
export function purchaseGenerator(
  state: GameState,
  config: GameConfig,
  generator: GeneratorId,
  requestedCount: number,
  modifiers: Modifiers,
): PurchaseResult {
  const unchanged: PurchaseResult = { state, purchased: ZERO, spent: ZERO };
  const def = getRegistry(config).generators.get(generator);
  const generatorState = state.generators[generator];
  if (def === undefined || generatorState === undefined || !generatorState.unlocked) {
    return unchanged;
  }

  const quote = quotePurchase(state, config, generator, requestedCount, modifiers);
  if (quote === null || quote.count.lte(ZERO)) return unchanged;

  const discount = costMultiplier(modifiers, generator);
  const budget = getAmount(state, quote.resource).div(discount);
  const affordableCount = minD(
    quote.count,
    maxAffordable(def.cost, generatorState.owned, budget),
  );
  if (affordableCount.lte(ZERO)) return unchanged;

  const cost = bulkCost(def.cost, generatorState.owned, affordableCount).mul(discount);
  if (getAmount(state, quote.resource).lt(cost)) return unchanged;

  const spent = spendResource(state, quote.resource, cost);
  return {
    state: {
      ...spent,
      generators: {
        ...spent.generators,
        [generator]: {
          ...generatorState,
          owned: generatorState.owned.add(affordableCount),
          lifetimePurchased: generatorState.lifetimePurchased.add(affordableCount),
        },
      },
    },
    purchased: affordableCount,
    spent: cost,
  };
}

/** Cost of exactly one more, for the UI's "next" price label. */
export function nextUnitCost(
  state: GameState,
  config: GameConfig,
  generator: GeneratorId,
  modifiers: Modifiers,
): Decimal {
  const def = getRegistry(config).generators.get(generator);
  const owned = state.generators[generator]?.owned;
  if (def === undefined || owned === undefined) return ZERO;
  return bulkCost(def.cost, owned, ONE).mul(costMultiplier(modifiers, generator));
}

export function setAutomationEnabled(
  state: GameState,
  generator: GeneratorId,
  enabled: boolean,
): GameState {
  const generatorState = state.generators[generator];
  if (generatorState === undefined) return state;
  return {
    ...state,
    generators: {
      ...state.generators,
      [generator]: { ...generatorState, automationEnabled: enabled },
    },
  };
}
