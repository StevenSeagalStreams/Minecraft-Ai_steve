import { purchaseUpgrade } from '../../features/upgrades/purchase';
import { ZERO } from '../../math/decimal';
import {
  amountOf,
  freshState,
  modifiersOf,
  ownedOf,
  snapshot,
  withGenerator,
  withResource,
  withUpgrade,
} from '../../testing/helpers';
import { TEST_CONFIG } from '../../testing/testConfig';
import { calculateOfflineProgress } from '../offline';
import { tick } from '../tick';

const config = TEST_CONFIG;

describe('calculateOfflineProgress', () => {
  it('ignores gaps shorter than the minimum', () => {
    const state = withGenerator(freshState(), 'g1', 10);
    const result = calculateOfflineProgress(state, 500, config);
    expect(result.applied).toBe(false);
    expect(result.creditedMs).toBe(0);
    expect(result.state).toBe(state);
  });

  it('declines cleanly on zero, negative and non-finite elapsed time', () => {
    const state = withGenerator(freshState(), 'g1', 10);
    for (const elapsed of [0, -1, -60_000, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = calculateOfflineProgress(state, elapsed, config);
      expect(result.applied).toBe(false);
      expect(result.creditedMs).toBe(0);
      expect(result.steps).toBe(0);
      expect(result.gains.size).toBe(0);
      expect(result.state).toBe(state);
      expect(amountOf(result.state, 'gold').eq(0)).toBe(true);
      expect(Number.isFinite(result.rawElapsedMs)).toBe(true);
    }
  });

  it('credits exactly the minimum-length gap', () => {
    const state = withGenerator(freshState(), 'g1', 10);
    const result = calculateOfflineProgress(state, config.offline.minElapsedMs, config);
    expect(result.applied).toBe(true);
    expect(result.creditedMs).toBe(config.offline.minElapsedMs);
  });

  it('credits elapsed time at the configured efficiency', () => {
    const state = withGenerator(freshState(), 'g1', 10);
    const result = calculateOfflineProgress(state, 10_000, config);
    // 10/s * 10s * 0.5 efficiency
    expect(amountOf(result.state, 'gold').eq(50)).toBe(true);
    expect(result.efficiency).toBe(0.5);
    expect(result.applied).toBe(true);
  });

  it('caps very long absences and reports what was discarded', () => {
    const state = withGenerator(freshState(), 'g1', 1);
    const week = 7 * 24 * 3_600_000;
    const result = calculateOfflineProgress(state, week, config);
    expect(result.creditedMs).toBe(config.offline.maxElapsedMs);
    expect(result.rawElapsedMs).toBe(week);
    expect(result.discardedMs).toBe(week - config.offline.maxElapsedMs);
  });

  it('bounds the step count even for a maximum-length absence', () => {
    const state = withGenerator(freshState(), 'g1', 1);
    const result = calculateOfflineProgress(state, config.offline.maxElapsedMs, config);
    // Step size is max(offline.stepMs, elapsed/maxSteps) clamped to maxTickMs,
    // so the loop never exceeds whichever of those bounds binds first.
    const bound = Math.max(
      config.offline.maxSteps,
      Math.ceil(config.offline.maxElapsedMs / config.time.maxTickMs),
    );
    expect(result.steps).toBeLessThanOrEqual(bound);
    expect(result.steps).toBeGreaterThan(0);
  });

  it('is deterministic for the same inputs', () => {
    const state = withGenerator(withResource(freshState(), 'gold', 10_000), 'g1', 20);
    const first = calculateOfflineProgress(state, 600_000, config);
    const second = calculateOfflineProgress(state, 600_000, config);
    expect(snapshot(first.state)).toBe(snapshot(second.state));
  });

  it('is exactly the online result scaled by efficiency', () => {
    const state = withGenerator(freshState(), 'g1', 3);
    const offline = calculateOfflineProgress(state, 10_000, config);

    // No automation is unlocked here, so online production is linear in time
    // and the only difference between the paths is the efficiency scale.
    let online = state;
    for (let index = 0; index < 10; index += 1) {
      online = tick(online, 1_000, config, { story: false }).state;
    }

    expect(
      amountOf(offline.state, 'gold').eq(amountOf(online, 'gold').mul(config.offline.efficiency)),
    ).toBe(true);
  });

  it('reports per-resource gains', () => {
    const state = withGenerator(freshState(), 'g1', 4);
    const result = calculateOfflineProgress(state, 10_000, config);
    expect(result.gains.get('gold')?.eq(20)).toBe(true);
    expect(result.gains.get('meta')).toBeUndefined();
  });

  it('lets autobuyers compound while away', () => {
    const rich = withResource(freshState(), 'gold', 10_000);
    const automated = purchaseUpgrade(rich, config, 'autoG1', modifiersOf(rich)).state;
    const result = calculateOfflineProgress(automated, 600_000, config);
    expect(ownedOf(result.state, 'g1').gt(ownedOf(automated, 'g1'))).toBe(true);
  });

  it('holds automation when the config disables it offline', () => {
    const manual = { ...config, offline: { ...config.offline, automationEnabled: false } };
    const rich = withResource(freshState(manual), 'gold', 10_000);
    const automated = purchaseUpgrade(rich, manual, 'autoG1', modifiersOf(rich, manual)).state;
    const result = calculateOfflineProgress(automated, 600_000, manual);
    expect(ownedOf(result.state, 'g1').eq(ZERO)).toBe(true);
  });

  it('raises efficiency with the offline bonus modifier, capped at 1', () => {
    const bonusConfig = {
      ...config,
      upgrades: [
        ...config.upgrades,
        {
          id: 'slowBurn',
          name: 'Slow Burn',
          description: 'Offline efficiency.',
          category: 'prestige' as const,
          cost: { kind: 'exponential' as const, resource: 'meta', base: '1', growth: '2' },
          maxLevel: 20,
          effects: [{ kind: 'offlineEfficiencyBonus' as const, amount: 0.1 }],
          unlock: null,
          requires: [],
          persistent: true,
        },
      ],
    };

    const state = withUpgrade(withGenerator(freshState(bonusConfig), 'g1', 1), 'slowBurn', 2);
    expect(calculateOfflineProgress(state, 10_000, bonusConfig).efficiency).toBeCloseTo(0.7, 10);

    const maxed = withUpgrade(state, 'slowBurn', 20);
    expect(calculateOfflineProgress(maxed, 10_000, bonusConfig).efficiency).toBe(1);
  });

  it('queues story beats once, after the simulation', () => {
    const state = withGenerator(freshState(), 'g1', 60);
    // 60/s at 0.5 efficiency for 60s = 1800 gold, past the 500 milestone.
    const result = calculateOfflineProgress(state, 60_000, config);
    // Everything eligible is queued once, in authored order, after the sim.
    expect(result.state.story.activeNode).toBe('intro');
    expect(result.state.story.queue).toEqual(['milestone', 'everyRun']);
  });

  it('records the credited time in stats', () => {
    const state = withGenerator(freshState(), 'g1', 1);
    const result = calculateOfflineProgress(state, 120_000, config);
    expect(result.state.stats.lastOfflineMs).toBe(120_000);
  });
});
