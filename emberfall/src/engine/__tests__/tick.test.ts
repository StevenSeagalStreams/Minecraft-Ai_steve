import { purchaseUpgrade } from '../../features/upgrades/purchase';
import { D, ZERO } from '../../math/decimal';
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
import { tick } from '../tick';

const config = TEST_CONFIG;

describe('tick', () => {
  it('is a no-op for zero, negative, and non-finite deltas', () => {
    const state = withGenerator(freshState(), 'g1', 5);
    for (const delta of [0, -1000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(tick(state, delta, config)).toBe(state);
    }
  });

  it('produces rate * time', () => {
    const state = withGenerator(freshState(), 'g1', 5);
    const next = tick(state, 2_000, config);
    expect(amountOf(next, 'gold').eq(10)).toBe(true);
  });

  it('credits lifetime and run totals alongside the balance', () => {
    const next = tick(withGenerator(freshState(), 'g1', 1), 1_000, config);
    const gold = next.resources.gold;
    expect(gold?.amount.eq(1)).toBe(true);
    expect(gold?.lifetimeEarned.eq(1)).toBe(true);
    expect(gold?.runEarned.eq(1)).toBe(true);
  });

  it('applies multipliers from upgrades', () => {
    const state = withUpgrade(withGenerator(freshState(), 'g1', 1), 'boost', 3);
    // 1/s * 2^3 levels * 1s
    expect(amountOf(tick(state, 1_000, config), 'gold').eq(8)).toBe(true);
  });

  it('clamps a delta larger than maxTickMs', () => {
    const state = withGenerator(freshState(), 'g1', 1);
    const clamped = tick(state, 60_000, config);
    expect(amountOf(clamped, 'gold').eq(config.time.maxTickMs / 1000)).toBe(true);
  });

  it('splits into equal parts identically to one combined tick', () => {
    const state = withGenerator(freshState(), 'g1', 7);
    const combined = tick(state, 4_000, config, { automation: false });
    let split = state;
    for (let index = 0; index < 4; index += 1) {
      split = tick(split, 1_000, config, { automation: false });
    }
    expect(amountOf(split, 'gold').eq(amountOf(combined, 'gold'))).toBe(true);
  });

  it('is deterministic — identical inputs give byte-identical output', () => {
    const state = withGenerator(withResource(freshState(), 'gold', 5_000), 'g1', 12);
    expect(snapshot(tick(state, 3_000, config))).toBe(snapshot(tick(state, 3_000, config)));
  });

  it('never mutates the input state', () => {
    const state = withGenerator(freshState(), 'g1', 4);
    const before = snapshot(state);
    tick(state, 5_000, config);
    expect(snapshot(state)).toBe(before);
  });

  it('scales production for offline catch-up', () => {
    const state = withGenerator(freshState(), 'g1', 10);
    const next = tick(state, 1_000, config, { scale: D('0.5') });
    expect(amountOf(next, 'gold').eq(5)).toBe(true);
  });

  it('advances play time and tick counters', () => {
    const next = tick(freshState(), 2_500, config);
    expect(next.stats.totalPlayTimeMs).toBe(2_500);
    expect(next.stats.runPlayTimeMs).toBe(2_500);
    expect(next.stats.totalTicks).toBe(1);
  });

  it('unlocks content once its condition holds', () => {
    const state = withGenerator(freshState(), 'g1', 100);
    expect(state.generators.g2?.unlocked).toBe(false);
    const next = tick(state, 2_000, config);
    expect(next.generators.g2?.unlocked).toBe(true);
  });

  it('queues story nodes whose triggers fire', () => {
    const next = tick(freshState(), 1_000, config);
    expect(next.story.activeNode).toBe('intro');
  });

  it('does not queue story nodes when story evaluation is disabled', () => {
    const next = tick(freshState(), 1_000, config, { story: false });
    expect(next.story.activeNode).toBeNull();
  });

  it('runs autobuyers only once automation is unlocked', () => {
    const rich = withResource(freshState(), 'gold', 1_000);
    expect(ownedOf(tick(rich, 1_000, config), 'g1').eq(ZERO)).toBe(true);

    const automated = purchaseUpgrade(rich, config, 'autoG1', modifiersOf(rich)).state;
    const next = tick(automated, 1_000, config);
    expect(next.upgrades.autoG1?.level).toBe(1);
    expect(ownedOf(next, 'g1').gt(ZERO)).toBe(true);
  });

  it('honours the automation opt-out flag', () => {
    const rich = withResource(freshState(), 'gold', 1_000);
    const automated = purchaseUpgrade(rich, config, 'autoG1', modifiersOf(rich)).state;
    const next = tick(automated, 1_000, config, { automation: false });
    expect(ownedOf(next, 'g1').eq(ZERO)).toBe(true);
  });

  it('applies an upgrade bought this frame from the next frame, not retroactively', () => {
    const state = withGenerator(withResource(freshState(), 'gold', 100), 'g1', 1);
    const bought = purchaseUpgrade(state, config, 'boost', modifiersOf(state)).state;
    expect(bought.upgrades.boost?.level).toBe(1);
    const next = tick(bought, 1_000, config, { automation: false });
    // Balance after buying is 0; one second at 1/s doubled by the new level.
    expect(amountOf(next, 'gold').eq(2)).toBe(true);
  });
});
