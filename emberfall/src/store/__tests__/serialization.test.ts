import { createInitialState } from '../../features/gameState';
import { resolveChoice } from '../../features/story/story';
import { applyStoryTriggers } from '../../features/story/triggers';
import { applyUnlocks } from '../../features/unlocks';
import { D, Decimal } from '../../math/decimal';
import {
  freshState,
  snapshot,
  withGenerator,
  withResource,
  withUpgrade,
} from '../../testing/helpers';
import { TEST_CONFIG, TEST_EPOCH } from '../../testing/testConfig';
import { deserializeGameState, serializeGameState } from '../serialization';

const config = TEST_CONFIG;

/**
 * A save with something interesting in every branch of the state tree.
 *
 * The unlock pass is applied because loading runs it too — the test helpers set
 * fields directly and would otherwise produce a state no real save could be in.
 */
function populatedState() {
  const base = withUpgrade(
    withGenerator(withResource(freshState(), 'gold', '1.234e45', '9.99e60'), 'g1', '1e12'),
    'boost',
    3,
  );
  const queued = applyStoryTriggers(applyUnlocks(base, config), config).state;
  return resolveChoice(queued, config, 'takeGold', TEST_EPOCH);
}

describe('Decimal survival across JSON', () => {
  it('is the reason the revive step exists — a Decimal comes back as a string', () => {
    // `Decimal.toJSON` means stringify succeeds, which is the trap: the value
    // looks fine in storage but parses back as a plain string with no methods.
    const naive = JSON.parse(JSON.stringify({ amount: new Decimal('1.23e45') })) as {
      amount: unknown;
    };
    expect(typeof naive.amount).toBe('string');
    expect(naive.amount).not.toBeInstanceOf(Decimal);
    expect(() => (naive.amount as Decimal).mul(2)).toThrow(TypeError);
  });

  it('revives every Decimal field as a real Decimal', () => {
    const state = populatedState();
    const revived = deserializeGameState(
      JSON.parse(JSON.stringify(serializeGameState(state))),
      config,
      TEST_EPOCH,
    );

    expect(revived.resources.gold?.amount).toBeInstanceOf(Decimal);
    expect(revived.resources.gold?.lifetimeEarned).toBeInstanceOf(Decimal);
    expect(revived.resources.gold?.runEarned).toBeInstanceOf(Decimal);
    expect(revived.generators.g1?.owned).toBeInstanceOf(Decimal);
    expect(revived.generators.g1?.lifetimePurchased).toBeInstanceOf(Decimal);
    expect(revived.prestige.lifetimeShards).toBeInstanceOf(Decimal);
    expect(revived.prestige.bestRunTotal).toBeInstanceOf(Decimal);
  });

  it('preserves values far beyond Number range', () => {
    const state = withResource(freshState(), 'gold', '1.234e45', '9.99e300');
    const revived = deserializeGameState(
      JSON.parse(JSON.stringify(serializeGameState(state))),
      config,
      TEST_EPOCH,
    );
    expect(revived.resources.gold?.amount.eq(D('1.234e45'))).toBe(true);
    expect(revived.resources.gold?.lifetimeEarned.eq(D('9.99e300'))).toBe(true);
  });
});

describe('round-trip fidelity', () => {
  it('returns an identical state through JSON', () => {
    const state = populatedState();
    const revived = deserializeGameState(
      JSON.parse(JSON.stringify(serializeGameState(state))),
      config,
      TEST_EPOCH,
    );
    expect(snapshot(revived)).toBe(snapshot(state));
  });

  it('is idempotent over repeated round-trips', () => {
    const state = populatedState();
    let current = state;
    for (let index = 0; index < 3; index += 1) {
      current = deserializeGameState(
        JSON.parse(JSON.stringify(serializeGameState(current))),
        config,
        TEST_EPOCH,
      );
    }
    expect(snapshot(current)).toBe(snapshot(state));
  });

  it('keeps story flags, history, queue and timestamps', () => {
    const state = populatedState();
    const revived = deserializeGameState(serializeGameState(state), config, TEST_EPOCH);
    expect(revived.story.flags.greedy).toBe(true);
    expect(revived.story.history).toEqual(state.story.history);
    expect(revived.story.seenNodes).toEqual(state.story.seenNodes);
    expect(revived.lastTickAt).toBe(state.lastTickAt);
    expect(revived.stats.createdAt).toBe(state.stats.createdAt);
  });
});

describe('robustness', () => {
  const pristine = createInitialState(config, TEST_EPOCH);

  it('falls back to a new game for non-object input', () => {
    for (const raw of [null, undefined, 42, 'nope', []]) {
      expect(snapshot(deserializeGameState(raw, config, TEST_EPOCH))).toBe(snapshot(pristine));
    }
  });

  it('replaces corrupt numeric fields instead of throwing', () => {
    const broken = {
      ...serializeGameState(populatedState()),
      resources: { gold: { amount: 'banana', lifetimeEarned: null, runEarned: {}, unlocked: 3 } },
    };
    const revived = deserializeGameState(broken, config, TEST_EPOCH);
    expect(revived.resources.gold?.amount.eq(0)).toBe(true);
    expect(revived.resources.gold?.unlocked).toBe(true); // config default
  });

  it('drops history entries that are not well formed', () => {
    const broken = {
      ...serializeGameState(populatedState()),
      story: {
        seenNodes: ['intro', 7],
        queue: null,
        activeNode: 12,
        flags: { greedy: true, bogus: 'yes' },
        history: [{ node: 'intro', choice: 'takeGold', atRun: 0, atMs: 1 }, { node: 'intro' }, 5],
      },
    };
    const revived = deserializeGameState(broken, config, TEST_EPOCH);
    expect(revived.story.seenNodes).toEqual(['intro']);
    expect(revived.story.queue).toEqual([]);
    expect(revived.story.activeNode).toBeNull();
    expect(revived.story.flags).toEqual({ greedy: true });
    expect(revived.story.history).toHaveLength(1);
  });

  it('clamps a negative or fractional upgrade level', () => {
    const broken = {
      ...serializeGameState(freshState()),
      upgrades: { boost: { level: -5, unlocked: true }, autoG1: { level: 2.7, unlocked: true } },
    };
    const revived = deserializeGameState(broken, config, TEST_EPOCH);
    expect(revived.upgrades.boost?.level).toBe(0);
    expect(revived.upgrades.autoG1?.level).toBe(2);
  });

  it('gives content added since the save its config defaults', () => {
    const old = serializeGameState(freshState());
    const expanded = {
      ...config,
      generators: [
        ...config.generators,
        {
          id: 'g3',
          name: 'Generator Three',
          description: 'Added in a later build.',
          tier: 3,
          produces: 'gold',
          baseRate: '100',
          cost: { kind: 'exponential' as const, resource: 'gold', base: '1e5', growth: '2' },
          unlock: null,
          unlockedAtStart: true,
        },
      ],
    };
    const revived = deserializeGameState(old, expanded, TEST_EPOCH);
    expect(revived.generators.g3?.owned.eq(0)).toBe(true);
    expect(revived.generators.g3?.unlocked).toBe(true);
  });

  it('drops content the config no longer defines', () => {
    const stale = {
      ...serializeGameState(freshState()),
      generators: {
        g1: { owned: '5', lifetimePurchased: '5', unlocked: true, automationEnabled: true },
        removedGenerator: { owned: '99', lifetimePurchased: '99', unlocked: true, automationEnabled: true },
      },
    };
    const revived = deserializeGameState(stale, config, TEST_EPOCH);
    expect(revived.generators.g1?.owned.eq(5)).toBe(true);
    expect(revived.generators.removedGenerator).toBeUndefined();
  });

  it('re-evaluates unlocks on load', () => {
    const earned = {
      ...serializeGameState(withResource(freshState(), 'gold', '5000')),
      generators: {
        g2: { owned: '0', lifetimePurchased: '0', unlocked: false, automationEnabled: true },
      },
    };
    const revived = deserializeGameState(earned, config, TEST_EPOCH);
    expect(revived.generators.g2?.unlocked).toBe(true);
  });
});
