import type { GameConfig } from '../types/defs';
import type { GameState } from '../types/state';
import { type DriftAssessment, assessTimeDrift } from './drift';
import { type OfflineResult, calculateOfflineProgress } from './offline';
import { type TickResult, tick } from './tick';

export interface AdvanceResult {
  readonly state: GameState;
  readonly drift: DriftAssessment;
  /** Populated only when the gap was credited as offline progress. */
  readonly offline: OfflineResult | null;
  /** Populated when the gap was integrated as a normal tick. */
  readonly tick: TickResult | null;
}

/**
 * Moves a save from `state.lastTickAt` to `now`, choosing between a normal tick
 * and offline catch-up based on how far the clock moved.
 *
 * `now` is a parameter, not a clock read, so the whole progression is
 * reproducible: feeding the same timestamps always yields the same state.
 * `lastTickAt` is advanced in every branch — including the backward-clock case,
 * which resynchronises without awarding anything.
 */
export function advance(state: GameState, now: number, config: GameConfig): AdvanceResult {
  const drift = assessTimeDrift(state.lastTickAt, now, config.time);

  switch (drift.kind) {
    case 'backward':
      return { state: { ...state, lastTickAt: now }, drift, offline: null, tick: null };

    case 'forwardJump': {
      const offline = calculateOfflineProgress(state, drift.offlineMs, config);
      if (offline.applied) {
        return { state: { ...offline.state, lastTickAt: now }, drift, offline, tick: null };
      }
      /**
       * The drift threshold and the offline minimum are independent config
       * values, so a gap can land between them — long enough to be routed here,
       * too short for offline progress to accept. Falling back to a tick means
       * that window is still credited instead of being silently dropped.
       */
      const result = tick(state, drift.offlineMs, config);
      return { state: { ...result.state, lastTickAt: now }, drift, offline, tick: result };
    }

    case 'normal':
    default: {
      const result = tick(state, drift.tickMs, config);
      return { state: { ...result.state, lastTickAt: now }, drift, offline: null, tick: result };
    }
  }
}
