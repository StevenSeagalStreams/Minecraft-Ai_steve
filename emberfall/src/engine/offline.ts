import { mergeGains } from '../features/idle/production';
import { applyStoryTriggers } from '../features/story/triggers';
import { computeModifiers } from '../features/upgrades/modifiers';
import { D, type Decimal } from '../math/decimal';
import type { GameConfig } from '../types/defs';
import type { ResourceId } from '../types/ids';
import type { GameState } from '../types/state';
import { tick } from './tick';

export interface OfflineResult {
  readonly state: GameState;
  /** Elapsed time actually simulated, after the cap. */
  readonly creditedMs: number;
  readonly rawElapsedMs: number;
  /** Time thrown away by the cap — surfaced to the player, not hidden. */
  readonly discardedMs: number;
  readonly steps: number;
  readonly efficiency: number;
  readonly gains: ReadonlyMap<ResourceId, Decimal>;
  /** False when the gap was too short, zero, or invalid to count as away time. */
  readonly applied: boolean;
}

function emptyResult(state: GameState, rawElapsedMs: number, efficiency: number): OfflineResult {
  return {
    state,
    creditedMs: 0,
    rawElapsedMs,
    discardedMs: 0,
    steps: 0,
    efficiency,
    gains: new Map(),
    applied: false,
  };
}

/**
 * Credits time spent away as a fixed-step simulation.
 *
 * Pure function of `(state, elapsedMs, config)` — the caller measures the gap,
 * this function decides what it is worth. Stepping (rather than a single large
 * integration) means autobuyers compound while away exactly as they would have
 * online, just scaled by the offline efficiency.
 *
 * Step size is `max(offline.stepMs, elapsed / offline.maxSteps)` clamped to
 * `time.maxTickMs`, which bounds the loop while keeping every step within the
 * range a normal tick would accept.
 */
export function calculateOfflineProgress(
  state: GameState,
  elapsedMs: number,
  config: GameConfig,
): OfflineResult {
  const modifiers = computeModifiers(state, config);
  const efficiency = Math.min(
    Math.max(config.offline.efficiency + modifiers.offlineEfficiencyBonus, 0),
    1,
  );

  // Zero, negative, non-finite and too-short gaps all decline identically:
  // the caller keeps the state it had and handles the remainder as a tick.
  if (!Number.isFinite(elapsedMs) || elapsedMs < config.offline.minElapsedMs) {
    return emptyResult(state, Number.isFinite(elapsedMs) ? Math.max(elapsedMs, 0) : 0, efficiency);
  }

  const creditedMs = Math.min(elapsedMs, config.offline.maxElapsedMs);
  const stepMs = Math.min(
    Math.max(config.offline.stepMs, Math.ceil(creditedMs / config.offline.maxSteps)),
    config.time.maxTickMs,
  );

  const scale = D(efficiency);
  const gains = new Map<ResourceId, Decimal>();
  let next = state;
  let remaining = creditedMs;
  let steps = 0;

  while (remaining > 0) {
    const delta = Math.min(stepMs, remaining);
    const result = tick(next, delta, config, {
      scale,
      automation: config.offline.automationEnabled,
      // Triggers are evaluated once at the end so the player returns to a
      // single ordered queue rather than a burst of mid-simulation beats.
      story: false,
    });
    next = result.state;
    mergeGains(gains, result.gains);
    remaining -= delta;
    steps += 1;
  }

  next = applyStoryTriggers(next, config).state;

  return {
    state: {
      ...next,
      stats: { ...next.stats, lastOfflineMs: creditedMs },
    },
    creditedMs,
    rawElapsedMs: elapsedMs,
    discardedMs: Math.max(elapsedMs - creditedMs, 0),
    steps,
    efficiency,
    gains,
    applied: true,
  };
}
