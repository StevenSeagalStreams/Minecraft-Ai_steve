import type { StoryNode } from '../../types/defs';
import { GENERATOR_IDS } from '../generators';
import { RESOURCE_IDS } from '../resources';
import { STORY_FLAGS } from '../storyFlags';
import { STORY_NODE_IDS } from './ids';

/**
 * Chapter 1 — the valley, the voice, and the first person willing to help.
 */
export const CHAPTER_1_NODES: readonly StoryNode[] = [
  {
    id: STORY_NODE_IDS.ignition,
    chapter: 1,
    title: 'Ignition',
    speaker: null,
    body:
      'The world went out the way a candle does — not all at once, but in a way ' +
      'that made everyone stop talking. You are holding the last of it. It is ' +
      'small enough to close your hand around, and warm enough that you do not.',
    trigger: { kind: 'always' },
    repeatAfterPrestige: false,
    choices: [
      {
        id: 'cup',
        text: 'Cup it. Keep it alive.',
        flavour: 'Your hands remember the shape of holding something fragile.',
        requires: null,
        effects: [
          { kind: 'grantResource', resource: RESOURCE_IDS.ember, amount: '10' },
          { kind: 'setStoryFlag', flag: STORY_FLAGS.keptTheName, value: true },
        ],
        nextNode: null,
      },
      {
        id: 'feed',
        text: 'Feed it everything you are carrying.',
        flavour: 'It takes the offering without gratitude, and grows.',
        requires: null,
        effects: [{ kind: 'grantResource', resource: RESOURCE_IDS.ember, amount: '25' }],
        nextNode: null,
      },
    ],
  },
  {
    id: STORY_NODE_IDS.firstLight,
    chapter: 1,
    title: 'First Light',
    speaker: 'A voice in the ash',
    body:
      '"You are the first heat in this valley for a long time," it says. It does ' +
      'not come from anywhere. "I am going to ask you a question, and I want you ' +
      'to answer it honestly. Are you keeping the fire, or is the fire keeping you?"',
    trigger: { kind: 'lifetimeResourceAtLeast', resource: RESOURCE_IDS.ember, amount: '100' },
    repeatAfterPrestige: false,
    choices: [
      {
        id: 'honest',
        text: '"I do not know."',
        flavour: 'The ash seems satisfied by this.',
        requires: null,
        effects: [
          { kind: 'setStoryFlag', flag: STORY_FLAGS.toldTheTruth, value: true },
          { kind: 'globalProductionMultiplier', factor: '1.1' },
        ],
        nextNode: null,
      },
      {
        id: 'defiant',
        text: '"I am keeping it. Obviously."',
        flavour: 'Something that is not quite laughter moves through the valley.',
        requires: null,
        effects: [{ kind: 'grantResource', resource: RESOURCE_IDS.ember, amount: '150' }],
        nextNode: null,
      },
    ],
  },
  {
    id: STORY_NODE_IDS.theAshwright,
    chapter: 1,
    title: 'The Ashwright',
    speaker: 'Sella, ashwright',
    body:
      'She has been sifting the same grey field since before you arrived. "Most ' +
      'of it is dead," she says, not looking up. "But dead is not the same as ' +
      'gone. Give me a reason and I will work for you."',
    trigger: { kind: 'generatorCountAtLeast', generator: GENERATOR_IDS.ashwright, count: '1' },
    repeatAfterPrestige: false,
    choices: [
      {
        id: 'hire',
        text: 'Give her the reason.',
        flavour: 'She nods once, and the field begins to give things up.',
        requires: null,
        effects: [
          { kind: 'generatorProductionMultiplier', generator: GENERATOR_IDS.ashwright, factor: '1.5' },
        ],
        nextNode: null,
      },
      {
        id: 'silent',
        text: 'Say nothing and keep working.',
        flavour: 'She works anyway. People do.',
        requires: null,
        effects: [{ kind: 'globalProductionMultiplier', factor: '1.05' }],
        nextNode: null,
      },
    ],
  },
];
