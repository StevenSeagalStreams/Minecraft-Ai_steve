import { D, type Decimal, ZERO } from '../../math/decimal';
import { unitCost } from '../../math/scaling';
import type { GameConfig, UpgradeDef } from '../../types/defs';
import type { UpgradeId } from '../../types/ids';
import type { GameState } from '../../types/state';
import { evaluateCondition } from '../conditions';
import { getRegistry } from '../registry';
import { getAmount, spendResource } from '../resources';
import type { Modifiers } from './modifiers';

/** Price of the next level, including the global cost modifier. */
export function upgradeCost(
  state: GameState,
  def: UpgradeDef,
  modifiers: Modifiers,
): Decimal {
  const level = state.upgrades[def.id]?.level ?? 0;
  return unitCost(def.cost, D(level)).mul(modifiers.globalCost);
}

export function isMaxLevel(state: GameState, def: UpgradeDef): boolean {
  return (state.upgrades[def.id]?.level ?? 0) >= def.maxLevel;
}

/** Prerequisite upgrades must each be at level 1 or higher. */
export function requirementsMet(state: GameState, def: UpgradeDef): boolean {
  return def.requires.every((id) => (state.upgrades[id]?.level ?? 0) >= 1);
}

export function canPurchaseUpgrade(
  state: GameState,
  config: GameConfig,
  def: UpgradeDef,
  modifiers: Modifiers,
): boolean {
  const upgradeState = state.upgrades[def.id];
  if (upgradeState === undefined || !upgradeState.unlocked) return false;
  if (isMaxLevel(state, def)) return false;
  if (!requirementsMet(state, def)) return false;
  if (!evaluateCondition(state, def.unlock, config)) return false;
  return getAmount(state, def.cost.resource).gte(upgradeCost(state, def, modifiers));
}

export interface UpgradePurchaseResult {
  readonly state: GameState;
  readonly purchased: boolean;
  readonly spent: Decimal;
}

export function purchaseUpgrade(
  state: GameState,
  config: GameConfig,
  upgrade: UpgradeId,
  modifiers: Modifiers,
): UpgradePurchaseResult {
  const unchanged: UpgradePurchaseResult = { state, purchased: false, spent: ZERO };
  const def = getRegistry(config).upgrades.get(upgrade);
  const upgradeState = state.upgrades[upgrade];
  if (def === undefined || upgradeState === undefined) return unchanged;
  if (!canPurchaseUpgrade(state, config, def, modifiers)) return unchanged;

  const cost = upgradeCost(state, def, modifiers);
  const spent = spendResource(state, def.cost.resource, cost);
  return {
    state: {
      ...spent,
      upgrades: {
        ...spent.upgrades,
        [upgrade]: { ...upgradeState, level: upgradeState.level + 1 },
      },
    },
    purchased: true,
    spent: cost,
  };
}
