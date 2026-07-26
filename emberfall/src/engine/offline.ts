import { D, type Decimal, ZERO } from '../math/decimal';
import { evaluateStoryTriggers } from '../features/story/triggers';
import { computeModifiers } from '../features/upgrades/modifiers';
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
  /** False when the gap was too short to count as being away. */
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

function diffResources(
  before: GameState,
  after: GameState,
): ReadonlyMap<ResourceId, Decimal> {
  const gains = new Map<ResourceId, Decimal>();
  for (const [id, resource] of Object.entries(after.resources)) {
    const previous = before.resources[id]?.amount ?? ZERO;
    const delta = resource.amount.sub(previous);
    if (delta.gt(ZERO)) gains.set(id, delta);
  }
  return gains;
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
export function computeOfflineProgress(
  state: GameState,
  elapsedMs: number,
  config: GameConfig,
): OfflineResult {
  const modifiers = computeModifiers(state, config);
  const efficiency = Math.min(
    Math.max(config.offline.efficiency + modifiers.offlineEfficiencyBonus, 0),
    1,
  );

  if (!Number.isFinite(elapsedMs) || elapsedMs < config.offline.minElapsedMs) {
    return emptyResult(state, Math.max(elapsedMs, 0), efficiency);
  }

  const creditedMs = Math.min(elapsedMs, config.offline.maxElapsedMs);
  const stepMs = Math.min(
    Math.max(config.offline.stepMs, Math.ceil(creditedMs / config.offline.maxSteps)),
    config.time.maxTickMs,
  );

  const scale = D(efficiency);
  let next = state;
  let remaining = creditedMs;
  let steps = 0;

  while (remaining > 0) {
    const delta = Math.min(stepMs, remaining);
    next = tick(next, delta, config, {
      scale,
      automation: config.offline.automationEnabled,
      // Triggers are evaluated once at the end so the player returns to a
      // single ordered queue rather than a burst of mid-simulation beats.
      story: false,
    });
    remaining -= delta;
    steps += 1;
  }

  next = evaluateStoryTriggers(next, config);

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
    gains: diffResources(state, next),
    applied: true,
  };
}
