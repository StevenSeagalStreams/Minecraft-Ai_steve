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
import { type TickOptions, tick } from '../tick';
import type { GameState } from '../../types/state';

const config = TEST_CONFIG;

/** Most assertions only care about the resulting state. */
const step = (state: GameState, deltaMs: number, options?: TickOptions): GameState =>
  tick(state, deltaMs, config, options).state;

describe('tick', () => {
  it('is a no-op for zero, negative, and non-finite deltas', () => {
    const state = withGenerator(freshState(), 'g1', 5);
    for (const delta of [0, -1000, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = tick(state, delta, config);
      expect(result.state).toBe(state);
      expect(result.elapsedMs).toBe(0);
      expect(result.gains.size).toBe(0);
      expect(result.triggered).toEqual([]);
    }
  });

  it('produces rate * time', () => {
    const state = withGenerator(freshState(), 'g1', 5);
    expect(amountOf(step(state, 2_000), 'gold').eq(10)).toBe(true);
  });

  it('reports what it credited in the result', () => {
    const result = tick(withGenerator(freshState(), 'g1', 5), 2_000, config);
    expect(result.gains.get('gold')?.eq(10)).toBe(true);
    expect(result.gains.get('meta')).toBeUndefined();
    expect(result.elapsedMs).toBe(2_000);
  });

  it('credits lifetime and run totals alongside the balance', () => {
    const gold = step(withGenerator(freshState(), 'g1', 1), 1_000).resources.gold;
    expect(gold?.amount.eq(1)).toBe(true);
    expect(gold?.lifetimeEarned.eq(1)).toBe(true);
    expect(gold?.runEarned.eq(1)).toBe(true);
  });

  it('applies multipliers from upgrades', () => {
    const state = withUpgrade(withGenerator(freshState(), 'g1', 1), 'boost', 3);
    // 1/s * 2^3 levels * 1s
    expect(amountOf(step(state, 1_000), 'gold').eq(8)).toBe(true);
  });

  it('clamps a delta larger than maxTickMs and reports the clamp', () => {
    const result = tick(withGenerator(freshState(), 'g1', 1), 60_000, config);
    expect(result.elapsedMs).toBe(config.time.maxTickMs);
    expect(amountOf(result.state, 'gold').eq(config.time.maxTickMs / 1000)).toBe(true);
  });

  it('splits into equal parts identically to one combined tick', () => {
    const state = withGenerator(freshState(), 'g1', 7);
    const combined = step(state, 4_000, { automation: false });
    let split = state;
    for (let index = 0; index < 4; index += 1) {
      split = step(split, 1_000, { automation: false });
    }
    expect(amountOf(split, 'gold').eq(amountOf(combined, 'gold'))).toBe(true);
  });

  it('is deterministic — identical inputs give byte-identical output', () => {
    const state = withGenerator(withResource(freshState(), 'gold', 5_000), 'g1', 12);
    expect(snapshot(step(state, 3_000))).toBe(snapshot(step(state, 3_000)));
  });

  it('never mutates the input state', () => {
    const state = withGenerator(freshState(), 'g1', 4);
    const before = snapshot(state);
    step(state, 5_000);
    expect(snapshot(state)).toBe(before);
  });

  it('scales production for offline catch-up', () => {
    const state = withGenerator(freshState(), 'g1', 10);
    expect(amountOf(step(state, 1_000, { scale: D('0.5') }), 'gold').eq(5)).toBe(true);
  });

  it('advances play time and tick counters', () => {
    const next = step(freshState(), 2_500);
    expect(next.stats.totalPlayTimeMs).toBe(2_500);
    expect(next.stats.runPlayTimeMs).toBe(2_500);
    expect(next.stats.totalTicks).toBe(1);
  });

  it('unlocks content once its condition holds', () => {
    const state = withGenerator(freshState(), 'g1', 100);
    expect(state.generators.g2?.unlocked).toBe(false);
    expect(step(state, 2_000).generators.g2?.unlocked).toBe(true);
  });

  it('queues story nodes whose triggers fire, and names them in the result', () => {
    const result = tick(freshState(), 1_000, config);
    expect(result.state.story.activeNode).toBe('intro');
    expect(result.triggered.map((node) => node.id)).toEqual(['intro']);
  });

  it('does not queue story nodes when story evaluation is disabled', () => {
    const result = tick(freshState(), 1_000, config, { story: false });
    expect(result.state.story.activeNode).toBeNull();
    expect(result.triggered).toEqual([]);
  });

  it('runs autobuyers only once automation is unlocked', () => {
    const rich = withResource(freshState(), 'gold', 1_000);
    expect(ownedOf(step(rich, 1_000), 'g1').eq(ZERO)).toBe(true);

    const automated = purchaseUpgrade(rich, config, 'autoG1', modifiersOf(rich)).state;
    const next = step(automated, 1_000);
    expect(next.upgrades.autoG1?.level).toBe(1);
    expect(ownedOf(next, 'g1').gt(ZERO)).toBe(true);
  });

  it('honours the automation opt-out flag', () => {
    const rich = withResource(freshState(), 'gold', 1_000);
    const automated = purchaseUpgrade(rich, config, 'autoG1', modifiersOf(rich)).state;
    expect(ownedOf(step(automated, 1_000, { automation: false }), 'g1').eq(ZERO)).toBe(true);
  });

  it('applies an upgrade bought this frame from the next frame, not retroactively', () => {
    const state = withGenerator(withResource(freshState(), 'gold', 100), 'g1', 1);
    const bought = purchaseUpgrade(state, config, 'boost', modifiersOf(state)).state;
    expect(bought.upgrades.boost?.level).toBe(1);
    // Balance after buying is 0; one second at 1/s doubled by the new level.
    expect(amountOf(step(bought, 1_000, { automation: false }), 'gold').eq(2)).toBe(true);
  });
});
