import type { GameConfig } from '../types/defs';
import type { GameState } from '../types/state';
import { type DriftAssessment, assessTimeDrift } from './drift';
import { type OfflineResult, computeOfflineProgress } from './offline';
import { tick } from './tick';

export interface AdvanceResult {
  readonly state: GameState;
  readonly drift: DriftAssessment;
  /** Populated only when the gap was credited as offline progress. */
  readonly offline: OfflineResult | null;
}

/**
 * Moves a save from `state.lastTickAt` to `now`, choosing between a normal tick
 * and offline catch-up based on how far the clock moved.
 *
 * `now` is a parameter, not a `Date.now()` call, so the whole progression is
 * reproducible: feeding the same timestamps always yields the same state.
 * `lastTickAt` is advanced in every branch — including the backward-clock case,
 * which resynchronises without awarding anything.
 */
export function advance(state: GameState, now: number, config: GameConfig): AdvanceResult {
  const drift = assessTimeDrift(state.lastTickAt, now, config.time);

  switch (drift.kind) {
    case 'backward':
      return { state: { ...state, lastTickAt: now }, drift, offline: null };

    case 'forwardJump': {
      const offline = computeOfflineProgress(state, drift.offlineMs, config);
      return { state: { ...offline.state, lastTickAt: now }, drift, offline };
    }

    case 'normal':
    default: {
      const next = tick(state, drift.tickMs, config);
      return { state: { ...next, lastTickAt: now }, drift, offline: null };
    }
  }
}
