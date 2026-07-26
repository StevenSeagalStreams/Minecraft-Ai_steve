import type { GameConfig, StoryChoice, StoryNode } from '../../types/defs';
import type { StoryChoiceId, StoryNodeId } from '../../types/ids';
import type { GameState } from '../../types/state';
import { evaluateCondition } from '../conditions';
import { applyImmediateEffects } from '../effects';
import { getRegistry } from '../registry';

export function getActiveNode(state: GameState, config: GameConfig): StoryNode | null {
  const id = state.story.activeNode;
  if (id === null) return null;
  return getRegistry(config).story.get(id) ?? null;
}

/** Choices whose `requires` condition currently holds. */
export function availableChoices(
  state: GameState,
  node: StoryNode,
  config: GameConfig,
): readonly StoryChoice[] {
  return node.choices.filter((choice) => evaluateCondition(state, choice.requires, config));
}

/** Marks the active node seen and promotes the next queued node. */
function closeActiveNode(state: GameState): GameState {
  const active = state.story.activeNode;
  if (active === null) return state;

  const queue = [...state.story.queue];
  const next = queue.shift() ?? null;
  const seenNodes = state.story.seenNodes.includes(active)
    ? state.story.seenNodes
    : [...state.story.seenNodes, active];

  return {
    ...state,
    story: { ...state.story, seenNodes, queue, activeNode: next },
  };
}

/**
 * Closes a node that has no choices (or that the player skipped). Immediate
 * effects only fire through `resolveChoice`, so dismissing never grants
 * anything.
 */
export function dismissActiveNode(state: GameState): GameState {
  return closeActiveNode(state);
}

/**
 * Applies a choice: immediate effects land now, the pick is recorded in history
 * (which is what re-derives its modifier effects on every load), and any
 * `nextNode` is queued ahead of the rest.
 *
 * `atMs` is passed in rather than read from the clock so the whole flow stays
 * deterministic and testable.
 */
export function resolveChoice(
  state: GameState,
  config: GameConfig,
  choiceId: StoryChoiceId,
  atMs: number,
): GameState {
  const node = getActiveNode(state, config);
  if (node === null) return state;

  const choice = node.choices.find((option) => option.id === choiceId);
  if (choice === undefined) return state;
  if (!evaluateCondition(state, choice.requires, config)) return state;

  const withEffects = applyImmediateEffects(state, choice.effects);
  const withHistory: GameState = {
    ...withEffects,
    story: {
      ...withEffects.story,
      history: [
        ...withEffects.story.history,
        {
          node: node.id,
          choice: choice.id,
          atRun: withEffects.prestige.count,
          atMs,
        },
      ],
    },
  };

  const closed = closeActiveNode(withHistory);
  return choice.nextNode === null ? closed : promoteImmediately(closed, choice.nextNode);
}

/**
 * A branch continuation must read as one uninterrupted scene, so it jumps the
 * queue instead of joining the back of it.
 */
function promoteImmediately(state: GameState, node: StoryNodeId): GameState {
  const active = state.story.activeNode;
  const queue = active === null ? state.story.queue : [active, ...state.story.queue];
  return { ...state, story: { ...state.story, activeNode: node, queue } };
}
