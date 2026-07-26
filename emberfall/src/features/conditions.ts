import { D } from '../math/decimal';
import type { ConditionDef } from '../types/conditions';
import type { GameConfig } from '../types/defs';
import type { GameState } from '../types/state';
import { getShards } from './resources';

/**
 * Single evaluator for every gate in the game. Pure: `(state, condition) ->
 * boolean`, with no clock access and no config lookups beyond what the
 * condition names.
 */
export function evaluateCondition(
  state: GameState,
  condition: ConditionDef | null,
  config: GameConfig,
): boolean {
  if (condition === null) return true;

  switch (condition.kind) {
    case 'always':
      return true;
    case 'never':
      return false;

    case 'resourceAtLeast': {
      const resource = state.resources[condition.resource];
      return resource !== undefined && resource.amount.gte(D(condition.amount));
    }
    case 'lifetimeResourceAtLeast': {
      const resource = state.resources[condition.resource];
      return resource !== undefined && resource.lifetimeEarned.gte(D(condition.amount));
    }
    case 'runResourceAtLeast': {
      const resource = state.resources[condition.resource];
      return resource !== undefined && resource.runEarned.gte(D(condition.amount));
    }

    case 'generatorCountAtLeast': {
      const generator = state.generators[condition.generator];
      return generator !== undefined && generator.owned.gte(D(condition.count));
    }
    case 'upgradeLevelAtLeast': {
      const upgrade = state.upgrades[condition.upgrade];
      return upgrade !== undefined && upgrade.level >= condition.level;
    }

    case 'prestigeCountAtLeast':
      return state.prestige.count >= condition.count;
    case 'shardsAtLeast':
      return getShards(state, config).gte(D(condition.amount));

    case 'storyFlag':
      return (state.story.flags[condition.flag] ?? false) === condition.value;
    case 'storyNodeSeen':
      return state.story.seenNodes.includes(condition.node);

    case 'runTimeAtLeast':
      return state.stats.runPlayTimeMs >= condition.ms;
    case 'totalTimeAtLeast':
      return state.stats.totalPlayTimeMs >= condition.ms;

    case 'all':
      return condition.conditions.every((child) => evaluateCondition(state, child, config));
    case 'any':
      return condition.conditions.some((child) => evaluateCondition(state, child, config));
    case 'not':
      return !evaluateCondition(state, condition.condition, config);

    default:
      return false;
  }
}
