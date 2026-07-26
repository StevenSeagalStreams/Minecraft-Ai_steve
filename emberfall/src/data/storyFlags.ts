/**
 * Narrative flags set by story choices. They gate later nodes, unlock the
 * story-category upgrades, and survive ascension (the world resets; what the
 * player agreed to does not).
 */
export const STORY_FLAGS = {
  toldTheTruth: 'toldTheTruth',
  keptTheName: 'keptTheName',
  acceptedCovenant: 'acceptedCovenant',
  refusedCovenant: 'refusedCovenant',
  sparedTheChoir: 'sparedTheChoir',
  knowsTheCycle: 'knowsTheCycle',
} as const;

export type StoryFlagKey = (typeof STORY_FLAGS)[keyof typeof STORY_FLAGS];
