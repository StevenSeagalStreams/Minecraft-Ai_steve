import { GAME_CONFIG } from '../data/config';
import { nextUnitCost, quotePurchase } from '../features/idle/generators';
import { generatorRate, productionPerSecond } from '../features/idle/production';
import { ascensionProgress, canAscend, computeShardGain } from '../features/prestige/prestige';
import { availableChoices, getActiveNode } from '../features/story/story';
import { getShards } from '../features/resources';
import { type Modifiers, computeModifiers } from '../features/upgrades/modifiers';
import { canPurchaseUpgrade, isMaxLevel, upgradeCost } from '../features/upgrades/purchase';
import { type Decimal, ZERO } from '../math/decimal';
import type {
  GameConfig,
  GeneratorDef,
  ResourceDef,
  StoryChoice,
  StoryNode,
  UpgradeDef,
} from '../types/defs';
import type { GameState } from '../types/state';

/**
 * Read-only views for the UI. Every function is pure and takes state + config,
 * so screens stay free of game logic and nothing here can mutate a save.
 */

export interface ResourceRow {
  readonly def: ResourceDef;
  readonly amount: Decimal;
  readonly perSecond: Decimal;
}

export function selectResourceRows(
  state: GameState,
  config: GameConfig = GAME_CONFIG,
  modifiers: Modifiers = computeModifiers(state, config),
): readonly ResourceRow[] {
  const rates = productionPerSecond(state, config, modifiers);
  return config.resources
    .filter((def) => state.resources[def.id]?.unlocked === true)
    .map((def) => ({
      def,
      amount: state.resources[def.id]?.amount ?? ZERO,
      perSecond: rates.get(def.id) ?? ZERO,
    }));
}

export interface GeneratorRow {
  readonly def: GeneratorDef;
  readonly owned: Decimal;
  readonly perSecond: Decimal;
  readonly nextCost: Decimal;
  readonly bulkCount: Decimal;
  readonly bulkCost: Decimal;
  readonly affordable: boolean;
  readonly automationUnlocked: boolean;
  readonly automationEnabled: boolean;
}

export function selectGeneratorRows(
  state: GameState,
  bulkBuy: number,
  config: GameConfig = GAME_CONFIG,
  modifiers: Modifiers = computeModifiers(state, config),
): readonly GeneratorRow[] {
  return config.generators
    .filter((def) => state.generators[def.id]?.unlocked === true)
    .map((def) => {
      const generator = state.generators[def.id];
      const quote = quotePurchase(state, config, def.id, bulkBuy, modifiers);
      return {
        def,
        owned: generator?.owned ?? ZERO,
        perSecond: generatorRate(state, def, modifiers),
        nextCost: nextUnitCost(state, config, def.id, modifiers),
        bulkCount: quote?.count ?? ZERO,
        bulkCost: quote?.cost ?? ZERO,
        affordable: quote?.affordable ?? false,
        automationUnlocked: modifiers.automationUnlocked.has(def.id),
        automationEnabled: generator?.automationEnabled ?? false,
      };
    });
}

export interface UpgradeRow {
  readonly def: UpgradeDef;
  readonly level: number;
  readonly cost: Decimal;
  readonly affordable: boolean;
  readonly maxed: boolean;
}

export function selectUpgradeRows(
  state: GameState,
  config: GameConfig = GAME_CONFIG,
  modifiers: Modifiers = computeModifiers(state, config),
): readonly UpgradeRow[] {
  return config.upgrades
    .filter((def) => state.upgrades[def.id]?.unlocked === true)
    .map((def) => ({
      def,
      level: state.upgrades[def.id]?.level ?? 0,
      cost: upgradeCost(state, def, modifiers),
      affordable: canPurchaseUpgrade(state, config, def, modifiers),
      maxed: isMaxLevel(state, def),
    }));
}

export interface PrestigeView {
  readonly shards: Decimal;
  readonly pendingGain: Decimal;
  readonly canAscend: boolean;
  readonly progress: number;
  readonly count: number;
  readonly lifetimeShards: Decimal;
  readonly bestRunTotal: Decimal;
  readonly globalMultiplier: Decimal;
}

export function selectPrestige(
  state: GameState,
  config: GameConfig = GAME_CONFIG,
  modifiers: Modifiers = computeModifiers(state, config),
): PrestigeView {
  return {
    shards: getShards(state, config),
    pendingGain: computeShardGain(state, config, modifiers),
    canAscend: canAscend(state, config, modifiers),
    progress: ascensionProgress(state, config),
    count: state.prestige.count,
    lifetimeShards: state.prestige.lifetimeShards,
    bestRunTotal: state.prestige.bestRunTotal,
    globalMultiplier: modifiers.globalProduction,
  };
}

export interface StoryView {
  readonly node: StoryNode;
  readonly choices: readonly StoryChoice[];
  readonly queued: number;
}

export function selectActiveStory(
  state: GameState,
  config: GameConfig = GAME_CONFIG,
): StoryView | null {
  const node = getActiveNode(state, config);
  if (node === null) return null;
  return {
    node,
    choices: availableChoices(state, node, config),
    queued: state.story.queue.length,
  };
}

export function selectModifiers(
  state: GameState,
  config: GameConfig = GAME_CONFIG,
): Modifiers {
  return computeModifiers(state, config);
}
