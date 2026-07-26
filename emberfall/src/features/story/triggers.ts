import type { GameConfig, StoryNode } from '../../types/defs';
import type { StoryNodeId } from '../../types/ids';
import type { GameState } from '../../types/state';
import { evaluateCondition } from '../conditions';

/**
 * A node is eligible when it has a trigger that currently holds, it has not
 * already been shown this run, and it is not already waiting in the queue.
 * Nodes without a trigger are reached only through another node's `nextNode`.
 */
export function isEligible(state: GameState, node: StoryNode, config: GameConfig): boolean {
  if (node.trigger === null) return false;
  if (state.story.seenNodes.includes(node.id)) return false;
  if (state.story.queue.includes(node.id)) return false;
  if (state.story.activeNode === node.id) return false;
  return evaluateCondition(state, node.trigger, config);
}

/**
 * Newly unlocked story nodes for this state — the pure predicate half of the
 * story system, called once per tick.
 *
 * Config order is the tie-break when several nodes fire at once, so the
 * narrative always arrives in authored order.
 */
export function evaluateStoryTriggers(
  state: GameState,
  config: GameConfig,
): readonly StoryNode[] {
  return config.story.filter((node) => isEligible(state, node, config));
}

/** Appends nodes to the queue, promoting the first one if nothing is active. */
export function enqueueNodes(state: GameState, nodes: readonly StoryNodeId[]): GameState {
  if (nodes.length === 0) return state;

  const queue = [...state.story.queue, ...nodes];
  const active = state.story.activeNode ?? queue.shift() ?? null;

  return {
    ...state,
    story: { ...state.story, queue, activeNode: active },
  };
}

/** Evaluates triggers and queues whatever fired. */
export function applyStoryTriggers(
  state: GameState,
  config: GameConfig,
): { readonly state: GameState; readonly triggered: readonly StoryNode[] } {
  const triggered = evaluateStoryTriggers(state, config);
  return {
    state: enqueueNodes(
      state,
      triggered.map((node) => node.id),
    ),
    triggered,
  };
}
