import type { StoryNode } from '../../types/defs';
import { CHAPTER_1_NODES } from './chapter1';
import { CHAPTER_2_NODES } from './chapter2';
import { CHAPTER_3_NODES } from './chapter3';

export { STORY_NODE_IDS } from './ids';

/**
 * Nodes with a `trigger` are queued by the engine the moment their condition
 * holds. Nodes without one are reachable only as another node's `nextNode`,
 * which is how branches resolve.
 *
 * Order matters: it is the tie-break when several nodes fire in the same tick,
 * so the narrative always arrives in authored order.
 */
export const STORY_NODES: readonly StoryNode[] = [
  ...CHAPTER_1_NODES,
  ...CHAPTER_2_NODES,
  ...CHAPTER_3_NODES,
];
