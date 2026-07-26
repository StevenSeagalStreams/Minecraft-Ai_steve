import { ONE, type Decimal } from '../math/decimal';
import { runAutomation } from '../features/idle/automation';
import { produce } from '../features/idle/production';
import { evaluateStoryTriggers } from '../features/story/triggers';
import { applyUnlocks } from '../features/unlocks';
import { computeModifiers } from '../features/upgrades/modifiers';
import type { GameConfig } from '../types/defs';
import type { GameState } from '../types/state';

const MS_PER_SECOND = 1000;

export interface TickOptions {
  /** Production scale — 1 online, `offline.efficiency` during catch-up. */
  readonly scale?: Decimal;
  /** Autobuyers run online; offline catch-up decides per config. */
  readonly automation?: boolean;
  /** Story triggers are collected during catch-up but not while replaying. */
  readonly story?: boolean;
}

/**
 * One engine step: `(state, deltaMs, config) -> state`.
 *
 * Pure and deterministic — no clock access, no randomness, no React. The order
 * below is fixed and is what makes online play and offline catch-up produce
 * identical results for the same elapsed time:
 *
 *   1. derive modifiers   2. produce   3. automation
 *   4. unlocks            5. story triggers
 *
 * Modifiers are derived before production so an upgrade bought this frame
 * applies from the next one, never retroactively.
 */
export function tick(
  state: GameState,
  deltaMs: number,
  config: GameConfig,
  options: TickOptions = {},
): GameState {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return state;

  const clampedMs = Math.min(deltaMs, config.time.maxTickMs);
  const modifiers = computeModifiers(state, config);

  let next = produce(state, clampedMs / MS_PER_SECOND, config, modifiers, options.scale ?? ONE);

  if (options.automation ?? true) {
    next = runAutomation(next, config, modifiers);
  }

  next = applyUnlocks(next, config);

  if (options.story ?? true) {
    next = evaluateStoryTriggers(next, config);
  }

  return {
    ...next,
    stats: {
      ...next.stats,
      totalPlayTimeMs: next.stats.totalPlayTimeMs + clampedMs,
      runPlayTimeMs: next.stats.runPlayTimeMs + clampedMs,
      totalTicks: next.stats.totalTicks + 1,
    },
  };
}
