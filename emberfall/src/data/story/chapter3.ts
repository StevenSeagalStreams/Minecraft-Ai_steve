import type { StoryNode } from '../../types/defs';
import { RESOURCE_IDS } from '../resources';
import { STORY_FLAGS } from '../storyFlags';
import { STORY_NODE_IDS } from './ids';

/**
 * Chapter 3 — distillation, the cycle, and the beats that repeat each rebirth.
 */
export const CHAPTER_3_NODES: readonly StoryNode[] = [
  {
    id: STORY_NODE_IDS.distillation,
    chapter: 3,
    title: 'Distillation',
    speaker: 'Sella, ashwright',
    body:
      '"Heat is a verb," she says, holding up the first thread of lumen. "This ' +
      'is a noun. You can build with a noun."',
    trigger: { kind: 'lifetimeResourceAtLeast', resource: RESOURCE_IDS.lumen, amount: '1' },
    repeatAfterPrestige: false,
    choices: [],
  },
  {
    id: STORY_NODE_IDS.theCycle,
    chapter: 3,
    title: 'The Cycle',
    speaker: 'A voice in the ash',
    body:
      '"You are close to the end of this one," it says, gently, the way you tell ' +
      'someone their shift is over. "What is left when it ends is not nothing. ' +
      'It is small and it is sharp and it will make the next one faster."',
    trigger: { kind: 'runResourceAtLeast', resource: RESOURCE_IDS.ember, amount: '5e8' },
    repeatAfterPrestige: false,
    choices: [
      {
        id: 'understand',
        text: '"So it was always going to end."',
        flavour: '"Yes. That is not the same as it not mattering."',
        requires: null,
        effects: [{ kind: 'setStoryFlag', flag: STORY_FLAGS.knowsTheCycle, value: true }],
        nextNode: null,
      },
    ],
  },
  {
    id: STORY_NODE_IDS.afterTheEnd,
    chapter: 3,
    title: 'After the End',
    speaker: null,
    body:
      'The valley is cold again, and grey, and it is yours again. In your hand ' +
      'is something small and sharp that was not there the first time. You know ' +
      'where the coals are now. That turns out to be most of it.',
    trigger: { kind: 'prestigeCountAtLeast', count: 1 },
    repeatAfterPrestige: false,
    choices: [],
  },
  {
    id: STORY_NODE_IDS.theNthValley,
    chapter: 3,
    title: 'The {rebirthCount}th Valley',
    speaker: 'A voice in the ash',
    body:
      '"Run {rebirthCount}," it says, and you cannot tell whether it is counting ' +
      'or keeping score. "{lifetime:ember} embers across all of them. You have ' +
      '{shards} shards in your hand and {owned:wickling} wicklings in the dark. ' +
      'You are getting better at this. I am not sure that is good news."',
    /**
     * Compound trigger: gates on rebirth count *and* a run threshold, and the
     * node repeats each ascension, so it reads differently every time.
     */
    trigger: {
      kind: 'all',
      conditions: [
        { kind: 'prestigeCountAtLeast', count: 1 },
        { kind: 'runResourceAtLeast', resource: RESOURCE_IDS.ember, amount: '1e6' },
      ],
    },
    repeatAfterPrestige: true,
    choices: [
      {
        id: 'steady',
        text: 'Ask for something that does not run out.',
        flavour: 'A slow, constant warmth. It will never be much. It will never stop.',
        requires: null,
        effects: [
          { kind: 'resourceProductionAdditive', resource: RESOURCE_IDS.ember, amount: '1e4' },
        ],
        nextNode: null,
      },
      {
        id: 'sharp',
        text: 'Ask for something you can carry out.',
        flavour: 'It hands you a shard, unasked, from nowhere.',
        requires: { kind: 'prestigeCountAtLeast', count: 2 },
        effects: [{ kind: 'grantResource', resource: RESOURCE_IDS.shard, amount: '5' }],
        nextNode: null,
      },
      {
        id: 'nothing',
        text: 'Ask for nothing.',
        flavour: '"That is the first interesting thing you have done."',
        requires: null,
        effects: [{ kind: 'prestigeGainMultiplier', factor: '1.1' }],
        nextNode: null,
      },
    ],
  },
];
