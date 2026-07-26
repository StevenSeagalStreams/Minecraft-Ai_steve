import type { ConditionDef } from '../../types/conditions';
import { freshState, withGenerator, withResource, withUpgrade } from '../../testing/helpers';
import { TEST_CONFIG } from '../../testing/testConfig';
import { evaluateCondition } from '../conditions';

const config = TEST_CONFIG;
const check = (state: Parameters<typeof evaluateCondition>[0], condition: ConditionDef): boolean =>
  evaluateCondition(state, condition, config);

/**
 * Every branch of `ConditionDef`. These predicates gate every unlock and every
 * story trigger in the game, so an unhandled kind silently locks content
 * forever — cheap to test, expensive to miss.
 */
describe('evaluateCondition', () => {
  it('treats a null condition as satisfied', () => {
    expect(evaluateCondition(freshState(), null, config)).toBe(true);
  });

  it('handles the constant conditions', () => {
    expect(check(freshState(), { kind: 'always' })).toBe(true);
    expect(check(freshState(), { kind: 'never' })).toBe(false);
  });

  it('compares current balances', () => {
    const state = withResource(freshState(), 'gold', '100');
    expect(check(state, { kind: 'resourceAtLeast', resource: 'gold', amount: '100' })).toBe(true);
    expect(check(state, { kind: 'resourceAtLeast', resource: 'gold', amount: '101' })).toBe(false);
    expect(check(state, { kind: 'resourceAtLeast', resource: 'ghost', amount: '1' })).toBe(false);
  });

  it('distinguishes lifetime from run totals', () => {
    // Spent down to nothing, but the lifetime total remembers.
    const state = withResource(freshState(), 'gold', '0', '1e6');
    expect(check(state, { kind: 'lifetimeResourceAtLeast', resource: 'gold', amount: '1e6' })).toBe(
      true,
    );
    expect(check(state, { kind: 'resourceAtLeast', resource: 'gold', amount: '1' })).toBe(false);
    expect(check(state, { kind: 'runResourceAtLeast', resource: 'gold', amount: '1e6' })).toBe(true);
  });

  it('compares generator counts', () => {
    const state = withGenerator(freshState(), 'g1', 5);
    expect(check(state, { kind: 'generatorCountAtLeast', generator: 'g1', count: '5' })).toBe(true);
    expect(check(state, { kind: 'generatorCountAtLeast', generator: 'g1', count: '6' })).toBe(false);
    expect(check(state, { kind: 'generatorCountAtLeast', generator: 'ghost', count: '1' })).toBe(
      false,
    );
  });

  it('compares upgrade levels', () => {
    const state = withUpgrade(freshState(), 'boost', 3);
    expect(check(state, { kind: 'upgradeLevelAtLeast', upgrade: 'boost', level: 3 })).toBe(true);
    expect(check(state, { kind: 'upgradeLevelAtLeast', upgrade: 'boost', level: 4 })).toBe(false);
  });

  it('compares rebirth count and shard balance', () => {
    const base = freshState();
    const reborn = { ...base, prestige: { ...base.prestige, count: 2 } };
    expect(check(reborn, { kind: 'prestigeCountAtLeast', count: 2 })).toBe(true);
    expect(check(reborn, { kind: 'prestigeCountAtLeast', count: 3 })).toBe(false);

    const rich = withResource(base, 'meta', '7');
    expect(check(rich, { kind: 'shardsAtLeast', amount: '7' })).toBe(true);
    expect(check(rich, { kind: 'shardsAtLeast', amount: '8' })).toBe(false);
  });

  it('reads story flags, including the unset case', () => {
    const base = freshState();
    const flagged = { ...base, story: { ...base.story, flags: { greedy: true } } };
    expect(check(flagged, { kind: 'storyFlag', flag: 'greedy', value: true })).toBe(true);
    expect(check(flagged, { kind: 'storyFlag', flag: 'greedy', value: false })).toBe(false);
    // An unset flag reads as false rather than as an error.
    expect(check(base, { kind: 'storyFlag', flag: 'greedy', value: false })).toBe(true);
  });

  it('checks whether a node has been seen', () => {
    const base = freshState();
    const seen = { ...base, story: { ...base.story, seenNodes: ['intro'] } };
    expect(check(seen, { kind: 'storyNodeSeen', node: 'intro' })).toBe(true);
    expect(check(seen, { kind: 'storyNodeSeen', node: 'milestone' })).toBe(false);
  });

  it('compares play time', () => {
    const base = freshState();
    const played = {
      ...base,
      stats: { ...base.stats, runPlayTimeMs: 5_000, totalPlayTimeMs: 60_000 },
    };
    expect(check(played, { kind: 'runTimeAtLeast', ms: 5_000 })).toBe(true);
    expect(check(played, { kind: 'runTimeAtLeast', ms: 5_001 })).toBe(false);
    expect(check(played, { kind: 'totalTimeAtLeast', ms: 60_000 })).toBe(true);
  });

  describe('compound conditions', () => {
    const yes: ConditionDef = { kind: 'always' };
    const no: ConditionDef = { kind: 'never' };

    it('requires every branch of an AND', () => {
      expect(check(freshState(), { kind: 'all', conditions: [yes, yes] })).toBe(true);
      expect(check(freshState(), { kind: 'all', conditions: [yes, no] })).toBe(false);
      // Vacuous truth: an empty AND holds.
      expect(check(freshState(), { kind: 'all', conditions: [] })).toBe(true);
    });

    it('requires one branch of an OR', () => {
      expect(check(freshState(), { kind: 'any', conditions: [no, yes] })).toBe(true);
      expect(check(freshState(), { kind: 'any', conditions: [no, no] })).toBe(false);
      expect(check(freshState(), { kind: 'any', conditions: [] })).toBe(false);
    });

    it('inverts with NOT', () => {
      expect(check(freshState(), { kind: 'not', condition: no })).toBe(true);
      expect(check(freshState(), { kind: 'not', condition: yes })).toBe(false);
    });

    it('nests to arbitrary depth', () => {
      const state = withGenerator(withResource(freshState(), 'gold', '500'), 'g1', 3);
      const condition: ConditionDef = {
        kind: 'all',
        conditions: [
          { kind: 'resourceAtLeast', resource: 'gold', amount: '100' },
          {
            kind: 'any',
            conditions: [
              { kind: 'prestigeCountAtLeast', count: 9 },
              { kind: 'generatorCountAtLeast', generator: 'g1', count: '3' },
            ],
          },
          { kind: 'not', condition: { kind: 'storyFlag', flag: 'greedy', value: true } },
        ],
      };
      expect(check(state, condition)).toBe(true);
    });
  });
});
