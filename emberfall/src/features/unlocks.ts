import type { GameConfig } from '../types/defs';
import type { GameState } from '../types/state';
import { evaluateCondition } from './conditions';
import { requirementsMet } from './upgrades/purchase';

/**
 * Re-evaluates every unlock gate. Unlocks are one-way within a run: once a
 * generator or upgrade is visible it stays visible, so a temporary dip in
 * resources cannot make the UI flicker. Ascension rebuilds state from scratch
 * and therefore re-locks anything that should be re-earned.
 */
export function applyUnlocks(state: GameState, config: GameConfig): GameState {
  let resources = state.resources;
  let changed = false;

  for (const def of config.resources) {
    const current = resources[def.id];
    if (current === undefined || current.unlocked) continue;
    if (!evaluateCondition(state, def.unlock, config)) continue;
    resources = { ...resources, [def.id]: { ...current, unlocked: true } };
    changed = true;
  }

  let generators = state.generators;
  for (const def of config.generators) {
    const current = generators[def.id];
    if (current === undefined || current.unlocked) continue;
    if (!evaluateCondition(state, def.unlock, config)) continue;
    generators = { ...generators, [def.id]: { ...current, unlocked: true } };
    changed = true;
  }

  let upgrades = state.upgrades;
  for (const def of config.upgrades) {
    const current = upgrades[def.id];
    if (current === undefined || current.unlocked) continue;
    if (!requirementsMet(state, def)) continue;
    if (!evaluateCondition(state, def.unlock, config)) continue;
    upgrades = { ...upgrades, [def.id]: { ...current, unlocked: true } };
    changed = true;
  }

  return changed ? { ...state, resources, generators, upgrades } : state;
}
