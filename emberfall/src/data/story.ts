import type { StoryNode } from '../types/defs';
import { GENERATOR_IDS } from './generators';
import { RESOURCE_IDS } from './resources';
import { STORY_FLAGS } from './storyFlags';

export const STORY_NODE_IDS = {
  ignition: 'ch1.ignition',
  firstLight: 'ch1.firstLight',
  theAshwright: 'ch1.theAshwright',
  theChoir: 'ch2.theChoir',
  covenant: 'ch2.covenant',
  covenantAccepted: 'ch2.covenantAccepted',
  covenantRefused: 'ch2.covenantRefused',
  distillation: 'ch3.distillation',
  theCycle: 'ch3.theCycle',
  afterTheEnd: 'ch3.afterTheEnd',
} as const;

/**
 * Nodes with a `trigger` are queued by the engine the moment their condition
 * holds. Nodes without one are reachable only as another node's `nextNode`,
 * which is how branches resolve.
 */
export const STORY_NODES: readonly StoryNode[] = [
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
];
