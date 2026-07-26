import { formatDecimal, formatWhole } from '../../math/format';
import type { GameConfig } from '../../types/defs';
import type { GameState } from '../../types/state';
import { getShards } from '../resources';

const TOKEN = /\{([a-zA-Z]+)(?::([A-Za-z0-9_.]+))?\}/g;

/**
 * Resolves one `{token}` or `{token:argument}` against the live state.
 * Returns `null` for anything unrecognised.
 */
function resolve(
  token: string,
  argument: string | undefined,
  state: GameState,
  config: GameConfig,
): string | null {
  const { formatting } = config;

  switch (token) {
    case 'rebirthCount':
      return String(state.prestige.count);
    case 'shards':
      return formatDecimal(getShards(state, config), formatting);
    case 'lifetimeShards':
      return formatDecimal(state.prestige.lifetimeShards, formatting);
    case 'resource':
      if (argument === undefined) return null;
      return formatDecimal(state.resources[argument]?.amount ?? 0, formatting);
    case 'lifetime':
      if (argument === undefined) return null;
      return formatDecimal(state.resources[argument]?.lifetimeEarned ?? 0, formatting);
    case 'run':
      if (argument === undefined) return null;
      return formatDecimal(state.resources[argument]?.runEarned ?? 0, formatting);
    case 'owned':
      if (argument === undefined) return null;
      return formatWhole(state.generators[argument]?.owned ?? 0, formatting);
    default:
      return null;
  }
}

/**
 * Fills a story template so the same node reads differently on each rebirth.
 *
 * Supported: `{rebirthCount}`, `{shards}`, `{lifetimeShards}`,
 * `{resource:id}`, `{lifetime:id}`, `{run:id}`, `{owned:generatorId}`.
 *
 * Unrecognised tokens are left in place rather than blanked, so an authoring
 * typo is visible in the text instead of silently deleting a sentence.
 */
export function interpolate(template: string, state: GameState, config: GameConfig): string {
  return template.replace(TOKEN, (match, token: string, argument?: string) => {
    const value = resolve(token, argument, state, config);
    return value ?? match;
  });
}
