import { D } from '../../math/decimal';
import { freshState, snapshot, withGenerator, withResource } from '../../testing/helpers';
import { TEST_CONFIG, TEST_EPOCH } from '../../testing/testConfig';
import {
  CURRENT_SAVE_VERSION,
  MIGRATIONS,
  type MigrationRegistry,
  migrateSave,
} from '../migrations';
import { createSaveFile, encodeSave, loadSave } from '../persistence';

const config = TEST_CONFIG;

describe('migrateSave', () => {
  const registry: MigrationRegistry = {
    1: (state) => ({ ...(state as object), addedInV2: true }),
    2: (state) => ({ ...(state as object), addedInV3: 'yes' }),
  };

  it('is a no-op when the save is already current', () => {
    const state = { a: 1 };
    const result = migrateSave(state, 3, registry, 3);
    expect(result.state).toBe(state);
    expect(result.steps).toBe(0);
    expect(result.incomplete).toBe(false);
  });

  it('walks a save forward one version at a time', () => {
    const result = migrateSave({ a: 1 }, 1, registry, 3);
    expect(result.state).toEqual({ a: 1, addedInV2: true, addedInV3: 'yes' });
    expect(result.steps).toBe(2);
    expect(result.toVersion).toBe(3);
    expect(result.incomplete).toBe(false);
  });

  it('runs a single step when only one version behind', () => {
    const result = migrateSave({ a: 1 }, 2, registry, 3);
    expect(result.state).toEqual({ a: 1, addedInV3: 'yes' });
    expect(result.steps).toBe(1);
  });

  it('reports incomplete when a step is missing', () => {
    const result = migrateSave({ a: 1 }, 0, registry, 3);
    expect(result.incomplete).toBe(true);
    expect(result.toVersion).toBe(0);
  });

  it('refuses to downgrade a save from a newer build', () => {
    const state = { a: 1 };
    const result = migrateSave(state, 9, registry, 3);
    expect(result.incomplete).toBe(true);
    expect(result.state).toBe(state);
  });

  it('rejects a nonsense version', () => {
    expect(migrateSave({}, -1, registry, 3).incomplete).toBe(true);
    expect(migrateSave({}, Number.NaN, registry, 3).incomplete).toBe(true);
  });

  it('migrates v0 (empty or corrupt) to a v1 payload', () => {
    // v0 means "no usable schema". It resolves to an empty payload, which
    // `deserializeGameState` turns into exactly the fresh default state.
    for (const junk of [null, 'a string', 42, [], undefined]) {
      expect(migrateSave(junk, 0).state).toEqual({});
    }
    expect(migrateSave({}, 0).incomplete).toBe(false);
    expect(migrateSave({}, 0).toVersion).toBe(CURRENT_SAVE_VERSION);
  });

  it('carries a salvageable v0 payload forward rather than discarding it', () => {
    const salvageable = { resources: { gold: { amount: '500' } } };
    const result = migrateSave(salvageable, 0);
    expect(result.state).toEqual(salvageable);
    expect(result.steps).toBe(1);
  });

  it('has a registry covering every version below the current one', () => {
    for (let version = 0; version < CURRENT_SAVE_VERSION; version += 1) {
      expect(MIGRATIONS[version]).toBeDefined();
    }
    expect(migrateSave({ a: 1 }, CURRENT_SAVE_VERSION).incomplete).toBe(false);
  });
});

describe('createSaveFile', () => {
  it('stamps the current version and the supplied time', () => {
    const save = createSaveFile(freshState(), TEST_EPOCH);
    expect(save.version).toBe(CURRENT_SAVE_VERSION);
    expect(save.savedAt).toBe(TEST_EPOCH);
    expect(typeof save.state.resources.gold?.amount).toBe('string');
  });
});

describe('loadSave', () => {
  const populated = withGenerator(withResource(freshState(), 'gold', '1.5e30'), 'g1', 42);

  it('round-trips a real save', () => {
    const result = loadSave(encodeSave(populated, TEST_EPOCH), config, TEST_EPOCH);
    expect(result.outcome).toBe('loaded');
    expect(result.savedAt).toBe(TEST_EPOCH);
    expect(result.fromVersion).toBe(CURRENT_SAVE_VERSION);
    expect(result.state.resources.gold?.amount.eq(D('1.5e30'))).toBe(true);
    expect(result.state.generators.g1?.owned.eq(42)).toBe(true);
  });

  it('starts a new game when there is nothing stored', () => {
    for (const raw of [null, undefined, '']) {
      const result = loadSave(raw, config, TEST_EPOCH);
      expect(result.outcome).toBe('empty');
      expect(snapshot(result.state)).toBe(snapshot(freshState()));
    }
  });

  it('starts a new game rather than throwing on malformed JSON', () => {
    const result = loadSave('{not json', config, TEST_EPOCH);
    expect(result.outcome).toBe('corrupt');
    expect(result.state.resources.gold?.amount.eq(0)).toBe(true);
  });

  it('treats a save without a version or state as corrupt', () => {
    expect(loadSave('{"savedAt":1}', config, TEST_EPOCH).outcome).toBe('corrupt');
    expect(loadSave('{"version":1}', config, TEST_EPOCH).outcome).toBe('corrupt');
    expect(loadSave('"a string"', config, TEST_EPOCH).outcome).toBe('corrupt');
    expect(loadSave('null', config, TEST_EPOCH).outcome).toBe('corrupt');
  });

  it('refuses a save written by a newer build instead of mangling it', () => {
    const future = JSON.stringify({
      version: CURRENT_SAVE_VERSION + 5,
      savedAt: TEST_EPOCH,
      state: {},
    });
    const result = loadSave(future, config, TEST_EPOCH);
    expect(result.outcome).toBe('futureVersion');
    expect(snapshot(result.state)).toBe(snapshot(freshState()));
  });

  it('reports a migrated save distinctly from a current one', () => {
    const registry: MigrationRegistry = {
      0: (state) => ({ ...(state as object), migrated: true }),
    };
    const old = JSON.stringify({
      version: 0,
      savedAt: TEST_EPOCH,
      state: createSaveFile(populated, TEST_EPOCH).state,
    });
    const result = loadSave(old, config, TEST_EPOCH, registry);
    expect(result.outcome).toBe('migrated');
    expect(result.fromVersion).toBe(0);
    expect(result.state.generators.g1?.owned.eq(42)).toBe(true);
  });

  it('falls back to a new game when a migration path is missing', () => {
    // Same v0 save as below, but handed a registry with no v0 entry.
    const old = JSON.stringify({ version: 0, savedAt: TEST_EPOCH, state: {} });
    expect(loadSave(old, config, TEST_EPOCH, {}).outcome).toBe('corrupt');
  });

  it('loads a v0 save as a fresh game through the real migration registry', () => {
    const v0 = JSON.stringify({ version: 0, savedAt: TEST_EPOCH, state: 'garbage' });
    const result = loadSave(v0, config, TEST_EPOCH);
    expect(result.outcome).toBe('migrated');
    expect(result.fromVersion).toBe(0);
    expect(snapshot(result.state)).toBe(snapshot(freshState()));
  });

  it('never throws, whatever it is handed', () => {
    const inputs = [
      '[]',
      '0',
      'true',
      '{"version":"x","state":{}}',
      '{"version":1,"state":"nope"}',
      '{"version":1,"state":{"resources":null}}',
      '{"version":1,"state":{"resources":{"gold":{"amount":"banana"}}}}',
    ];
    for (const raw of inputs) {
      expect(() => loadSave(raw, config, TEST_EPOCH)).not.toThrow();
    }
  });
});
