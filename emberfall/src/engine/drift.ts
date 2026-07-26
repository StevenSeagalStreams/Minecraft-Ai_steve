import type { TimeConfigDef } from '../types/defs';

export type DriftKind =
  /** A normal frame: integrate the elapsed time online. */
  | 'normal'
  /** The clock moved backwards (timezone change, manual adjustment, NTP). */
  | 'backward'
  /** A jump large enough that it should be credited as offline progress. */
  | 'forwardJump';

export interface DriftAssessment {
  readonly kind: DriftKind;
  readonly rawElapsedMs: number;
  /** Time to integrate as a normal tick — 0 for backward/offline cases. */
  readonly tickMs: number;
  /** Time to credit through offline progress — 0 unless `forwardJump`. */
  readonly offlineMs: number;
  /** True when the movement looks like clock tampering rather than lag. */
  readonly suspicious: boolean;
}

/**
 * Classifies the gap between the last engine step and `now`.
 *
 * Deliberately pure: both timestamps are arguments, so drift handling is fully
 * testable without mocking the clock. A backward-moving clock never credits
 * production — the safest response to an ambiguous signal is to award nothing
 * and let the next honest tick pick up.
 */
export function assessTimeDrift(
  lastTickAt: number,
  now: number,
  config: TimeConfigDef,
): DriftAssessment {
  const rawElapsedMs = now - lastTickAt;

  if (!Number.isFinite(rawElapsedMs)) {
    return { kind: 'backward', rawElapsedMs: 0, tickMs: 0, offlineMs: 0, suspicious: true };
  }

  if (rawElapsedMs < 0) {
    return {
      kind: 'backward',
      rawElapsedMs,
      tickMs: 0,
      offlineMs: 0,
      suspicious: Math.abs(rawElapsedMs) > config.maxBackwardDriftMs,
    };
  }

  if (rawElapsedMs > config.maxForwardDriftMs) {
    return {
      kind: 'forwardJump',
      rawElapsedMs,
      tickMs: 0,
      offlineMs: rawElapsedMs,
      suspicious: false,
    };
  }

  return {
    kind: 'normal',
    rawElapsedMs,
    tickMs: Math.min(rawElapsedMs, config.maxTickMs),
    offlineMs: 0,
    suspicious: false,
  };
}
