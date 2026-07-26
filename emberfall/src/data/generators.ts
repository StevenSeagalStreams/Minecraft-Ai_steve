import type { GeneratorDef } from '../types/defs';
import { RESOURCE_IDS } from './resources';

export const GENERATOR_IDS = {
  wickling: 'wickling',
  ashwright: 'ashwright',
  cinderChoir: 'cinderChoir',
  pyreWarden: 'pyreWarden',
  emberforge: 'emberforge',
  lumenWeaver: 'lumenWeaver',
  sunlessChoir: 'sunlessChoir',
} as const;

/**
 * Seven tiers spanning the whole run. Ember tiers 1-5 carry the early and mid
 * game; the two Lumen tiers open once a run has produced its first million
 * embers and give the prestige loop something to climb toward.
 */
export const GENERATORS: readonly GeneratorDef[] = [
  {
    id: GENERATOR_IDS.wickling,
    name: 'Wickling',
    description: 'A hand-cupped flame. It does not ask for much.',
    tier: 1,
    produces: RESOURCE_IDS.ember,
    baseRate: '0.1',
    cost: { kind: 'exponential', resource: RESOURCE_IDS.ember, base: '10', growth: '1.12' },
    unlock: null,
    unlockedAtStart: true,
  },
  {
    id: GENERATOR_IDS.ashwright,
    name: 'Ashwright',
    description: 'Sifts cold ash for the coals still thinking about burning.',
    tier: 2,
    produces: RESOURCE_IDS.ember,
    baseRate: '1',
    cost: { kind: 'exponential', resource: RESOURCE_IDS.ember, base: '120', growth: '1.14' },
    unlock: { kind: 'runResourceAtLeast', resource: RESOURCE_IDS.ember, amount: '60' },
    unlockedAtStart: false,
  },
  {
    id: GENERATOR_IDS.cinderChoir,
    name: 'Cinder Choir',
    description: 'Voices that keep the fire honest.',
    tier: 3,
    produces: RESOURCE_IDS.ember,
    baseRate: '12',
    cost: { kind: 'exponential', resource: RESOURCE_IDS.ember, base: '1.5e3', growth: '1.16' },
    unlock: { kind: 'runResourceAtLeast', resource: RESOURCE_IDS.ember, amount: '900' },
    unlockedAtStart: false,
  },
  {
    id: GENERATOR_IDS.pyreWarden,
    name: 'Pyre Warden',
    description: 'Tends the great pyres so the dark keeps its distance.',
    tier: 4,
    produces: RESOURCE_IDS.ember,
    baseRate: '150',
    cost: { kind: 'exponential', resource: RESOURCE_IDS.ember, base: '2e4', growth: '1.18' },
    unlock: { kind: 'runResourceAtLeast', resource: RESOURCE_IDS.ember, amount: '1.2e4' },
    unlockedAtStart: false,
  },
  {
    id: GENERATOR_IDS.emberforge,
    name: 'Emberforge',
    description: 'Industry, finally. The heat is no longer a memory.',
    tier: 5,
    produces: RESOURCE_IDS.ember,
    baseRate: '2e3',
    cost: { kind: 'exponential', resource: RESOURCE_IDS.ember, base: '3.5e5', growth: '1.2' },
    unlock: { kind: 'runResourceAtLeast', resource: RESOURCE_IDS.ember, amount: '2e5' },
    unlockedAtStart: false,
  },
  {
    id: GENERATOR_IDS.lumenWeaver,
    name: 'Lumen Weaver',
    description: 'Spins raw heat into something that will hold a shape.',
    tier: 6,
    produces: RESOURCE_IDS.lumen,
    baseRate: '0.05',
    cost: { kind: 'exponential', resource: RESOURCE_IDS.ember, base: '1e7', growth: '1.25' },
    unlock: { kind: 'runResourceAtLeast', resource: RESOURCE_IDS.ember, amount: '1e6' },
    unlockedAtStart: false,
  },
  {
    id: GENERATOR_IDS.sunlessChoir,
    name: 'Sunless Choir',
    description: 'They sing to a sun that has not existed for a long time.',
    tier: 7,
    produces: RESOURCE_IDS.lumen,
    baseRate: '2',
    cost: { kind: 'exponential', resource: RESOURCE_IDS.lumen, base: '250', growth: '1.3' },
    unlock: { kind: 'runResourceAtLeast', resource: RESOURCE_IDS.lumen, amount: '100' },
    unlockedAtStart: false,
  },
];
