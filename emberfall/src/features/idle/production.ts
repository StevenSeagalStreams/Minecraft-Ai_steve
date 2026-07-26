import { D, type Decimal, ONE, ZERO } from '../../math/decimal';
import type { GameConfig, GeneratorDef } from '../../types/defs';
import type { GeneratorId, ResourceId } from '../../types/ids';
import type { GameState } from '../../types/state';
import { getRegistry } from '../registry';
import { addResource } from '../resources';
import { type Modifiers, generatorMultiplier } from '../upgrades/modifiers';

/** Units per second contributed by one generator at its current count. */
export function generatorRate(
  state: GameState,
  def: GeneratorDef,
  modifiers: Modifiers,
): Decimal {
  const owned = state.generators[def.id]?.owned ?? ZERO;
  if (owned.lte(ZERO)) return ZERO;
  return D(def.baseRate).mul(owned).mul(generatorMultiplier(modifiers, def));
}

/** Total per-second output for every resource, keyed by resource id. */
export function productionPerSecond(
  state: GameState,
  config: GameConfig,
  modifiers: Modifiers,
): ReadonlyMap<ResourceId, Decimal> {
  const totals = new Map<ResourceId, Decimal>();
  for (const def of config.generators) {
    const rate = generatorRate(state, def, modifiers);
    if (rate.lte(ZERO)) continue;
    totals.set(def.produces, (totals.get(def.produces) ?? ZERO).add(rate));
  }
  return totals;
}

export function resourceRate(
  state: GameState,
  config: GameConfig,
  modifiers: Modifiers,
  resource: ResourceId,
): Decimal {
  return productionPerSecond(state, config, modifiers).get(resource) ?? ZERO;
}

/**
 * Credits `seconds` worth of production.
 *
 * `scale` is the offline-efficiency factor (1 while the app is in front of the
 * player). Production is integrated as `rate * seconds` against a snapshot of
 * the state, so ordering between generators can never affect the result.
 */
export function produce(
  state: GameState,
  seconds: number,
  config: GameConfig,
  modifiers: Modifiers,
  scale: Decimal = ONE,
): GameState {
  if (!Number.isFinite(seconds) || seconds <= 0) return state;
  const elapsed = D(seconds).mul(scale);
  if (elapsed.lte(ZERO)) return state;

  let next = state;
  for (const [resource, rate] of productionPerSecond(state, config, modifiers)) {
    next = addResource(next, resource, rate.mul(elapsed));
  }
  return next;
}

/** Per-generator rates, for the UI's contribution breakdown. */
export function generatorRates(
  state: GameState,
  config: GameConfig,
  modifiers: Modifiers,
): ReadonlyMap<GeneratorId, Decimal> {
  const registry = getRegistry(config);
  const rates = new Map<GeneratorId, Decimal>();
  for (const [id, def] of registry.generators) {
    rates.set(id, generatorRate(state, def, modifiers));
  }
  return rates;
}
