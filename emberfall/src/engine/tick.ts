import { runAutomation } from '../features/idle/automation';
import { applyGains, computeGains } from '../features/idle/production';
import { applyStoryTriggers } from '../features/story/triggers';
import { applyUnlocks } from '../features/unlocks';
import { computeModifiers } from '../features/upgrades/modifiers';
import { type Decimal, ONE } from '../math/decimal';
import type { GameConfig, StoryNode } from '../types/defs';
import type { ResourceId } from '../types/ids';
import type { GameState } from '../types/state';

const MS_PER_SECOND = 1000;

export interface TickResult {
  readonly state: GameState;
  /** Resources credited by this tick, before anything automation spent. */
  readonly gains: ReadonlyMap<ResourceId, Decimal>;
  /** Story nodes this tick newly queued. */
  readonly triggered: readonly StoryNode[];
  /** Time actually integrated, after clamping to `time.maxTickMs`. */
  readonly elapsedMs: number;
}

export interface TickOptions {
  /** Production scale — 1 online, `offline.efficiency` during catch-up. */
  readonly scale?: Decimal;
  /** Autobuyers run online; offline catch-up decides per config. */
  readonly automation?: boolean;
  /** Story triggers are collected during catch-up but not while replaying. */
  readonly story?: boolean;
}

const EMPTY_GAINS: ReadonlyMap<ResourceId, Decimal> = new Map();

function unchanged(state: GameState): TickResult {
  return { state, gains: EMPTY_GAINS, triggered: [], elapsedMs: 0 };
}

/**
 * One engine step: `(state, deltaMs, config) -> TickResult`.
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
): TickResult {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return unchanged(state);

  const elapsedMs = Math.min(deltaMs, config.time.maxTickMs);
  const modifiers = computeModifiers(state, config);

  const gains = computeGains(
    state,
    elapsedMs / MS_PER_SECOND,
    config,
    modifiers,
    options.scale ?? ONE,
  );
  let next = applyGains(state, gains);

  if (options.automation ?? true) {
    next = runAutomation(next, config, modifiers);
  }

  next = applyUnlocks(next, config);

  let triggered: readonly StoryNode[] = [];
  if (options.story ?? true) {
    const story = applyStoryTriggers(next, config);
    next = story.state;
    triggered = story.triggered;
  }

  return {
    state: {
      ...next,
      stats: {
        ...next.stats,
        totalPlayTimeMs: next.stats.totalPlayTimeMs + elapsedMs,
        runPlayTimeMs: next.stats.runPlayTimeMs + elapsedMs,
        totalTicks: next.stats.totalTicks + 1,
      },
    },
    gains,
    triggered,
    elapsedMs,
  };
}
