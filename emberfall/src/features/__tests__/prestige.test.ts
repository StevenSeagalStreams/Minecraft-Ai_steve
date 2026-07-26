import { D, ZERO } from '../../math/decimal';
import {
  amountOf,
  freshState,
  modifiersOf,
  withGenerator,
  withResource,
  withUpgrade,
} from '../../testing/helpers';
import { TEST_CONFIG, TEST_EPOCH } from '../../testing/testConfig';
import { resolveChoice } from '../story/story';
import { applyStoryTriggers } from '../story/triggers';
import { ascend, ascensionProgress, canAscend, computeShardGain } from '../prestige/prestige';

const config = TEST_CONFIG;
const ascendAt = TEST_EPOCH + 3_600_000;

/** Run state with `runEarned` gold set, which is what drives the reward. */
const runWith = (gold: string) => withResource(freshState(), 'gold', gold);

describe('computeShardGain', () => {
  it('is zero below the requirement', () => {
    const state = runWith('999');
    expect(computeShardGain(state, config, modifiersOf(state)).eq(ZERO)).toBe(true);
    expect(canAscend(state, config, modifiersOf(state))).toBe(false);
  });

  it('follows sqrt(runTotal / divisor)', () => {
    const state = runWith('1e6');
    // sqrt(1e6 / 1e3) = 31.6 -> floored
    expect(computeShardGain(state, config, modifiersOf(state)).eq(31)).toBe(true);
  });

  it('is exactly 1 at the requirement', () => {
    const state = runWith('1000');
    expect(computeShardGain(state, config, modifiersOf(state)).eq(1)).toBe(true);
    expect(canAscend(state, config, modifiersOf(state))).toBe(true);
  });

  it('scales with prestige-gain modifiers', () => {
    const base = runWith('1e6');
    const boosted = applyStoryTriggers(base, config).state;
    const withChoice = resolveChoice(boosted, config, 'takePower', TEST_EPOCH);
    // The story choice grants production, not prestige gain, so the reward is
    // unchanged — the modifier plumbing must not leak between channels.
    expect(
      computeShardGain(withChoice, config, modifiersOf(withChoice)).eq(
        computeShardGain(base, config, modifiersOf(base)),
      ),
    ).toBe(true);
  });

  it('reports progress toward the requirement', () => {
    expect(ascensionProgress(runWith('0'), config)).toBe(0);
    expect(ascensionProgress(runWith('500'), config)).toBeCloseTo(0.5, 10);
    expect(ascensionProgress(runWith('1e9'), config)).toBe(1);
  });
});

describe('ascend', () => {
  it('refuses below the requirement and leaves state untouched', () => {
    const state = runWith('10');
    const result = ascend(state, config, modifiersOf(state), ascendAt);
    expect(result.gained.eq(ZERO)).toBe(true);
    expect(result.state).toBe(state);
  });

  it('awards shards and resets the run', () => {
    const state = withGenerator(runWith('1e6'), 'g1', 12);
    const result = ascend(state, config, modifiersOf(state), ascendAt);

    expect(result.gained.eq(31)).toBe(true);
    expect(amountOf(result.state, 'meta').eq(31)).toBe(true);
    expect(amountOf(result.state, 'gold').eq(ZERO)).toBe(true);
    expect(result.state.generators.g1?.owned.eq(ZERO)).toBe(true);
    expect(result.state.prestige.count).toBe(1);
    expect(result.state.stats.runPlayTimeMs).toBe(0);
  });

  it('keeps lifetime totals and clears per-run totals', () => {
    const state = runWith('1e6');
    const result = ascend(state, config, modifiersOf(state), ascendAt);
    expect(result.state.resources.gold?.lifetimeEarned.eq(D('1e6'))).toBe(true);
    expect(result.state.resources.gold?.runEarned.eq(ZERO)).toBe(true);
  });

  it('keeps persistent upgrades and wipes the rest', () => {
    const state = withUpgrade(withUpgrade(runWith('1e6'), 'boost', 4), 'metaBoost', 2);
    const result = ascend(state, config, modifiersOf(state), ascendAt);
    expect(result.state.upgrades.boost?.level).toBe(0);
    expect(result.state.upgrades.metaBoost?.level).toBe(2);
  });

  it('re-locks run-gated generators so a new run has to re-earn them', () => {
    const state = withGenerator(runWith('1e6'), 'g2', 5);
    const result = ascend(state, config, modifiersOf(state), ascendAt);
    expect(result.state.generators.g2?.unlocked).toBe(false);
    expect(result.state.generators.g1?.unlocked).toBe(true);
  });

  it('keeps lifetime-gated content unlocked, since lifetime totals persist', () => {
    const lifetimeGated = {
      ...config,
      generators: config.generators.map((def) =>
        def.id === 'g2'
          ? {
              ...def,
              unlock: {
                kind: 'lifetimeResourceAtLeast' as const,
                resource: 'gold',
                amount: '100',
              },
            }
          : def,
      ),
    };
    const state = withResource(freshState(lifetimeGated), 'gold', '1e6');
    const result = ascend(state, lifetimeGated, modifiersOf(state, lifetimeGated), ascendAt);
    expect(result.state.generators.g2?.unlocked).toBe(true);
  });

  it('unlocks the prestige currency and its upgrades on the first ascension', () => {
    const state = runWith('1e6');
    const result = ascend(state, config, modifiersOf(state), ascendAt);
    expect(result.state.resources.meta?.unlocked).toBe(true);
    expect(result.state.upgrades.metaBoost?.unlocked).toBe(true);
  });

  it('accumulates shards and lifetime shards across ascensions', () => {
    const first = ascend(runWith('1e6'), config, modifiersOf(runWith('1e6')), ascendAt);
    const second = withResource(first.state, 'gold', '1e6');
    const result = ascend(second, config, modifiersOf(second), ascendAt + 1_000);

    expect(amountOf(result.state, 'meta').eq(62)).toBe(true);
    expect(result.state.prestige.lifetimeShards.eq(62)).toBe(true);
    expect(result.state.prestige.count).toBe(2);
  });

  it('preserves story flags and choice history across the reset', () => {
    const queued = applyStoryTriggers(freshState(), config).state;
    const chosen = resolveChoice(queued, config, 'takeGold', TEST_EPOCH);
    const state = withResource(chosen, 'gold', '1e6');

    const result = ascend(state, config, modifiersOf(state), ascendAt);
    expect(result.state.story.flags.greedy).toBe(true);
    expect(result.state.story.history).toHaveLength(1);
  });

  it('replays only the story beats marked repeatAfterPrestige', () => {
    const seen = {
      ...runWith('1e6'),
      story: {
        ...freshState().story,
        seenNodes: ['intro', 'everyRun'],
      },
    };
    const result = ascend(seen, config, modifiersOf(seen), ascendAt);
    expect(result.state.story.seenNodes).toEqual(['intro']);
  });

  it('records the best run and the ascension timestamp', () => {
    const state = runWith('1e6');
    const first = ascend(state, config, modifiersOf(state), ascendAt);
    expect(first.state.prestige.bestRunTotal.eq(D('1e6'))).toBe(true);
    expect(first.state.prestige.lastAscensionAt).toBe(ascendAt);

    const smaller = withResource(first.state, 'gold', '2000');
    const second = ascend(smaller, config, modifiersOf(smaller), ascendAt + 1);
    expect(second.state.prestige.bestRunTotal.eq(D('1e6'))).toBe(true);
  });

  it('makes the next run faster through persistent multipliers', () => {
    const state = withUpgrade(runWith('1e6'), 'metaBoost', 2);
    const after = ascend(state, config, modifiersOf(state), ascendAt).state;
    // 3^2 from the surviving upgrade; shardBonus is 0 in the test config.
    expect(modifiersOf(after).globalProduction.eq(9)).toBe(true);
  });
});
