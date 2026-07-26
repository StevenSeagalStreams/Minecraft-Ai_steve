import { amountOf, freshState, modifiersOf, withGenerator, withResource } from '../../testing/helpers';
import { TEST_CONFIG, TEST_EPOCH } from '../../testing/testConfig';
import { availableChoices, dismissActiveNode, getActiveNode, resolveChoice } from '../story/story';
import {
  applyStoryTriggers,
  enqueueNodes,
  evaluateStoryTriggers,
} from '../story/triggers';

const config = TEST_CONFIG;

/** Ids of the nodes that would fire right now. */
const triggeredIds = (state: Parameters<typeof evaluateStoryTriggers>[0]): string[] =>
  evaluateStoryTriggers(state, config).map((node) => node.id);

describe('story triggers', () => {
  it('queues nodes whose condition holds, in authored order', () => {
    const state = withGenerator(withResource(freshState(), 'gold', '1000'), 'g1', 5);
    expect(triggeredIds(state)).toEqual(['intro', 'milestone', 'everyRun']);
  });

  it('promotes the first queued node and keeps the rest waiting', () => {
    const state = applyStoryTriggers(withResource(freshState(), 'gold', '1000'), config).state;
    expect(state.story.activeNode).toBe('intro');
    expect(state.story.queue).toEqual(['milestone']);
  });

  it('never queues a node without a trigger', () => {
    expect(triggeredIds(freshState())).not.toContain('branch');
  });

  it('does not re-queue an active, queued, or already-seen node', () => {
    const first = applyStoryTriggers(freshState(), config).state;
    const second = applyStoryTriggers(first, config).state;
    expect(second.story.queue).toEqual(first.story.queue);
    expect(second.story.activeNode).toBe('intro');

    const dismissed = dismissActiveNode(first);
    expect(triggeredIds(dismissed)).not.toContain('intro');
  });

  it('ignores an empty enqueue', () => {
    const state = freshState();
    expect(enqueueNodes(state, [])).toBe(state);
  });
});

describe('resolveChoice', () => {
  const queued = applyStoryTriggers(freshState(), config).state;

  it('applies immediate effects', () => {
    const next = resolveChoice(queued, config, 'takeGold', TEST_EPOCH);
    expect(amountOf(next, 'gold').eq(100)).toBe(true);
    expect(next.story.flags.greedy).toBe(true);
  });

  it('records the choice in history with the run it happened in', () => {
    const next = resolveChoice(queued, config, 'takeGold', TEST_EPOCH);
    expect(next.story.history).toEqual([
      { node: 'intro', choice: 'takeGold', atRun: 0, atMs: TEST_EPOCH },
    ]);
  });

  it('derives modifier effects from history rather than storing them', () => {
    const next = resolveChoice(queued, config, 'takePower', TEST_EPOCH);
    expect(modifiersOf(next).globalProduction.eq(2)).toBe(true);
    // Nothing about the multiplier is written into state — only the pick is.
    expect(next.story.history).toHaveLength(1);
  });

  it('marks the node seen and clears it from the active slot', () => {
    const next = resolveChoice(queued, config, 'takeGold', TEST_EPOCH);
    expect(next.story.seenNodes).toContain('intro');
    expect(next.story.activeNode).toBeNull();
  });

  it('plays a branch continuation immediately, ahead of the queue', () => {
    const withBacklog = enqueueNodes(queued, ['milestone']);
    const next = resolveChoice(withBacklog, config, 'takePower', TEST_EPOCH);
    expect(next.story.activeNode).toBe('branch');
    expect(next.story.queue).toEqual(['milestone']);
  });

  it('ignores an unknown choice id', () => {
    expect(resolveChoice(queued, config, 'nope', TEST_EPOCH)).toBe(queued);
  });

  it('ignores a choice when no node is active', () => {
    const idle = freshState();
    expect(resolveChoice(idle, config, 'takeGold', TEST_EPOCH)).toBe(idle);
  });

  it('rejects a choice whose requirement is unmet', () => {
    const gated = {
      ...config,
      story: config.story.map((node) =>
        node.id === 'intro'
          ? {
              ...node,
              choices: node.choices.map((choice) => ({
                ...choice,
                requires: { kind: 'never' as const },
              })),
            }
          : node,
      ),
    };
    const state = applyStoryTriggers(freshState(gated), gated).state;
    expect(resolveChoice(state, gated, 'takeGold', TEST_EPOCH)).toBe(state);
  });
});

describe('active node helpers', () => {
  it('resolves the active node definition', () => {
    const state = applyStoryTriggers(freshState(), config).state;
    expect(getActiveNode(state, config)?.title).toBe('Intro');
    expect(getActiveNode(freshState(), config)).toBeNull();
  });

  it('lists only choices whose requirement holds', () => {
    const state = applyStoryTriggers(freshState(), config).state;
    const node = getActiveNode(state, config);
    expect(node).not.toBeNull();
    if (node !== null) {
      expect(availableChoices(state, node, config)).toHaveLength(2);
    }
  });

  it('dismissing a node grants nothing but advances the queue', () => {
    const state = enqueueNodes(applyStoryTriggers(freshState(), config).state, ['milestone']);
    const next = dismissActiveNode(state);
    expect(amountOf(next, 'gold').eq(0)).toBe(true);
    expect(next.story.seenNodes).toContain('intro');
    expect(next.story.activeNode).toBe('milestone');
    expect(next.story.history).toHaveLength(0);
  });

  it('dismissing with nothing active is a no-op', () => {
    const state = freshState();
    expect(dismissActiveNode(state)).toBe(state);
  });
});
