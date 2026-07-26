import type { GameConfig } from '../../types/defs';
import type { GameState } from '../../types/state';
import type { Modifiers } from '../upgrades/modifiers';
import { BUY_MAX, purchaseGenerator } from './generators';

/**
 * Runs every enabled autobuyer once.
 *
 * Generators are visited highest tier first so spare income flows into the
 * strongest producer the player can afford rather than being soaked up by
 * tier 1. The order is derived from config, so it is stable across runs and
 * identical online and offline — a requirement for deterministic catch-up.
 */
export function runAutomation(
  state: GameState,
  config: GameConfig,
  modifiers: Modifiers,
): GameState {
  const ordered = [...config.generators].sort((a, b) => b.tier - a.tier);

  let next = state;
  for (const def of ordered) {
    if (!modifiers.automationUnlocked.has(def.id)) continue;
    const generatorState = next.generators[def.id];
    if (generatorState === undefined) continue;
    if (!generatorState.unlocked || !generatorState.automationEnabled) continue;
    next = purchaseGenerator(next, config, def.id, BUY_MAX, modifiers).state;
  }
  return next;
}
