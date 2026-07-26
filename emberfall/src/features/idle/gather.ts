import { D, type Decimal } from '../../math/decimal';
import type { GameConfig } from '../../types/defs';
import type { GameState } from '../../types/state';
import { addResource } from '../resources';
import type { Modifiers } from '../upgrades/modifiers';
import { resourceRate } from './production';

/**
 * Yield of one manual tap: a flat base scaled by the global multiplier, plus a
 * slice of current output.
 *
 * The production term is what keeps tapping from becoming an insult in the
 * midgame while guaranteeing it never competes with generators — it is worth a
 * fixed fraction of a second no matter how large the numbers get.
 */
export function gatherAmount(
  state: GameState,
  config: GameConfig,
  modifiers: Modifiers,
): Decimal {
  const { resource, baseAmount, secondsOfProduction } = config.manualGather;
  const flat = D(baseAmount).mul(modifiers.globalProduction);
  const share = resourceRate(state, config, modifiers, resource).mul(secondsOfProduction);
  return flat.add(share);
}

export interface GatherResult {
  readonly state: GameState;
  readonly gained: Decimal;
}

/** Credits one manual tap. Pure: no clock, no randomness. */
export function manualGather(
  state: GameState,
  config: GameConfig,
  modifiers: Modifiers,
): GatherResult {
  const gained = gatherAmount(state, config, modifiers);
  return {
    state: addResource(state, config.manualGather.resource, gained),
    gained,
  };
}
