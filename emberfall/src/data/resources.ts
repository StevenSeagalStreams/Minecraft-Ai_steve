import type { ResourceDef } from '../types/defs';

export const RESOURCE_IDS = {
  ember: 'ember',
  lumen: 'lumen',
  shard: 'emberShard',
} as const;

export const RESOURCES: readonly ResourceDef[] = [
  {
    id: RESOURCE_IDS.ember,
    name: 'Embers',
    shortName: 'EMB',
    description: 'The last warmth of a world that forgot how to burn.',
    icon: '🔥',
    startingAmount: '0',
    persistent: false,
    unlockedAtStart: true,
    unlock: null,
  },
  {
    id: RESOURCE_IDS.lumen,
    name: 'Lumen',
    shortName: 'LUM',
    description: 'Light distilled from ember, stable enough to shape.',
    icon: '✦',
    startingAmount: '0',
    persistent: false,
    unlockedAtStart: false,
    unlock: {
      kind: 'lifetimeResourceAtLeast',
      resource: RESOURCE_IDS.ember,
      amount: '1e6',
    },
  },
  {
    id: RESOURCE_IDS.shard,
    name: 'Ember Shards',
    shortName: 'SHD',
    description: 'What remains of a world after it ends. Carried into the next.',
    icon: '◈',
    startingAmount: '0',
    persistent: true,
    unlockedAtStart: false,
    unlock: { kind: 'prestigeCountAtLeast', count: 1 },
  },
];
