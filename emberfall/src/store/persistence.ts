import { createInitialState } from '../features/gameState';
import type { GameConfig } from '../types/defs';
import type { SaveFile } from '../types/save';
import type { GameState } from '../types/state';
import { CURRENT_SAVE_VERSION, type MigrationRegistry, migrateSave } from './migrations';
import { deserializeGameState, serializeGameState } from './serialization';

export function createSaveFile(state: GameState, savedAt: number): SaveFile {
  return {
    version: CURRENT_SAVE_VERSION,
    savedAt,
    state: serializeGameState(state),
  };
}

export function encodeSave(state: GameState, savedAt: number): string {
  return JSON.stringify(createSaveFile(state, savedAt));
}

export type LoadOutcome =
  /** A save was read and is at the current version. */
  | 'loaded'
  /** A save was read and walked forward from an older version. */
  | 'migrated'
  /** No save was present — a new game was started. */
  | 'empty'
  /** Something was present but unusable; a new game was started. */
  | 'corrupt'
  /** The save is newer than this build understands; a new game was started. */
  | 'futureVersion';

export interface LoadResult {
  readonly state: GameState;
  readonly outcome: LoadOutcome;
  readonly savedAt: number | null;
  readonly fromVersion: number | null;
}

function freshResult(config: GameConfig, now: number, outcome: LoadOutcome): LoadResult {
  return { state: createInitialState(config, now), outcome, savedAt: null, fromVersion: null };
}

/**
 * Turns raw stored text into a live state.
 *
 * Every failure path ends in a playable game rather than a thrown error: an
 * absent, malformed, or future-versioned save all fall back to a new run, and
 * the outcome is reported so the UI can tell the player what happened instead
 * of silently swallowing a lost save.
 */
export function loadSave(
  raw: string | null | undefined,
  config: GameConfig,
  now: number,
  registry?: MigrationRegistry,
): LoadResult {
  if (raw === null || raw === undefined || raw.length === 0) {
    return freshResult(config, now, 'empty');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return freshResult(config, now, 'corrupt');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return freshResult(config, now, 'corrupt');
  }

  const candidate = parsed as Partial<SaveFile>;
  const version = typeof candidate.version === 'number' ? candidate.version : null;
  if (version === null || candidate.state === undefined) {
    return freshResult(config, now, 'corrupt');
  }

  if (version > CURRENT_SAVE_VERSION) {
    return freshResult(config, now, 'futureVersion');
  }

  const migration = migrateSave(candidate.state, version, registry);
  if (migration.incomplete) {
    return freshResult(config, now, 'corrupt');
  }

  return {
    state: deserializeGameState(migration.state, config, now),
    outcome: migration.steps > 0 ? 'migrated' : 'loaded',
    savedAt: typeof candidate.savedAt === 'number' ? candidate.savedAt : null,
    fromVersion: version,
  };
}
