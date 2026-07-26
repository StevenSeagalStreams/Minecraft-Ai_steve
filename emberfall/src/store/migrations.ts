/**
 * Save-file versioning.
 *
 * Any change to the *shape* of persisted state requires bumping
 * `CURRENT_SAVE_VERSION` and adding a migration keyed by the version it
 * upgrades **from**. Migrations run in sequence (`3 -> 4 -> 5`), each one
 * taking and returning opaque data, so an old save is walked forward one step
 * at a time rather than special-cased.
 *
 * Adding new resources, generators, upgrades or story nodes does *not* need a
 * migration: `deserializeGameState` layers saves onto a state built from the
 * current config, so unknown-to-the-save content arrives at its defaults.
 */
export const CURRENT_SAVE_VERSION = 1;

export type MigrationFn = (state: unknown) => unknown;

/** Keyed by source version: `MIGRATIONS[n]` upgrades a v`n` save to v`n+1`. */
export type MigrationRegistry = Readonly<Record<number, MigrationFn>>;

export const MIGRATIONS: MigrationRegistry = {
  // v1 is the first published schema, so there is nothing to migrate yet.
  // Example of what an entry looks like:
  //
  //   1: (state) => ({ ...(state as object), newField: 0 }),
};

export interface MigrationResult {
  readonly state: unknown;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly steps: number;
  /** True when the save could not be walked all the way to the current one. */
  readonly incomplete: boolean;
}

/**
 * Walks a persisted payload from `fromVersion` to `CURRENT_SAVE_VERSION`.
 *
 * A save newer than this build is returned untouched and flagged `incomplete`;
 * the caller decides whether to load it or start fresh. Downgrading is never
 * attempted — guessing at a future schema loses more than it saves.
 */
export function migrateSave(
  state: unknown,
  fromVersion: number,
  registry: MigrationRegistry = MIGRATIONS,
  targetVersion: number = CURRENT_SAVE_VERSION,
): MigrationResult {
  if (!Number.isFinite(fromVersion) || fromVersion < 0) {
    return { state, fromVersion, toVersion: fromVersion, steps: 0, incomplete: true };
  }
  if (fromVersion > targetVersion) {
    return { state, fromVersion, toVersion: fromVersion, steps: 0, incomplete: true };
  }

  let current = state;
  let version = fromVersion;
  let steps = 0;

  while (version < targetVersion) {
    const migrate = registry[version];
    if (migrate === undefined) {
      return { state: current, fromVersion, toVersion: version, steps, incomplete: true };
    }
    current = migrate(current);
    version += 1;
    steps += 1;
  }

  return { state: current, fromVersion, toVersion: version, steps, incomplete: false };
}
