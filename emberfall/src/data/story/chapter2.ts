import type { StoryNode } from '../../types/defs';
import { GENERATOR_IDS } from '../generators';
import { RESOURCE_IDS } from '../resources';
import { STORY_FLAGS } from '../storyFlags';
import { STORY_NODE_IDS } from './ids';

/**
 * Chapter 2 — the choir, and the offer that names the prestige loop out loud.
 */
export const CHAPTER_2_NODES: readonly StoryNode[] = [
  {
    id: STORY_NODE_IDS.theChoir,
    chapter: 2,
    title: 'The Choir',
    speaker: 'Sella, ashwright',
    body:
      '"They sing to keep the coals from forgetting," she says. "It works. That ' +
      'is the part nobody likes." The choir does not stop when you approach. ' +
      'They are singing the names of everything that used to be warm.',
    trigger: { kind: 'generatorCountAtLeast', generator: GENERATOR_IDS.cinderChoir, count: '3' },
    repeatAfterPrestige: false,
    choices: [
      {
        id: 'listen',
        text: 'Listen until they finish.',
        flavour: 'They do not finish. You stay anyway.',
        requires: null,
        effects: [
          { kind: 'setStoryFlag', flag: STORY_FLAGS.sparedTheChoir, value: true },
          { kind: 'tierProductionMultiplier', tier: 3, factor: '1.5' },
        ],
        nextNode: null,
      },
      {
        id: 'work',
        text: 'Put them to work on the pyres instead.',
        flavour: 'The singing stops. The output does not.',
        requires: null,
        effects: [{ kind: 'globalProductionMultiplier', factor: '1.2' }],
        nextNode: null,
      },
    ],
  },
  {
    id: STORY_NODE_IDS.covenant,
    chapter: 2,
    title: 'The Covenant',
    speaker: 'A voice in the ash',
    body:
      '"Here is the offer," it says. "I will give you more heat than this valley ' +
      'has held in a century. In exchange, when it goes out — and it will go out ' +
      '— you agree to start again. Knowingly. That is the whole price."',
    trigger: { kind: 'lifetimeResourceAtLeast', resource: RESOURCE_IDS.ember, amount: '1e7' },
    repeatAfterPrestige: false,
    choices: [
      {
        id: 'accept',
        text: 'Accept the covenant.',
        flavour: null,
        requires: null,
        effects: [{ kind: 'setStoryFlag', flag: STORY_FLAGS.acceptedCovenant, value: true }],
        nextNode: STORY_NODE_IDS.covenantAccepted,
      },
      {
        id: 'refuse',
        text: 'Refuse. You will do it on your own terms.',
        flavour: null,
        requires: null,
        effects: [{ kind: 'setStoryFlag', flag: STORY_FLAGS.refusedCovenant, value: true }],
        nextNode: STORY_NODE_IDS.covenantRefused,
      },
    ],
  },
  {
    id: STORY_NODE_IDS.covenantAccepted,
    chapter: 2,
    title: 'Signed in Ash',
    speaker: 'A voice in the ash',
    body:
      '"Good." Something enormous relaxes. "You should know that everyone says ' +
      'yes. I ask anyway. It matters that you were asked."',
    trigger: null,
    repeatAfterPrestige: false,
    choices: [],
  },
  {
    id: STORY_NODE_IDS.covenantRefused,
    chapter: 2,
    title: 'Unsigned',
    speaker: 'A voice in the ash',
    body:
      '"Also good," it says, and means it. "You will start again regardless. ' +
      'But you will do it without having promised to, and that is not nothing."',
    trigger: null,
    repeatAfterPrestige: false,
    choices: [
      {
        id: 'nod',
        text: 'Get back to work.',
        flavour: 'The valley is warmer than it was. You did that.',
        requires: null,
        effects: [{ kind: 'prestigeGainMultiplier', factor: '1.25' }],
        nextNode: null,
      },
    ],
  },
];
