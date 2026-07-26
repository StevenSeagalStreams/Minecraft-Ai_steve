/**
 * Branded-ish id aliases. They are plain strings so that data files stay
 * literal, but naming them documents intent at every call site.
 */
export type ResourceId = string;
export type GeneratorId = string;
export type UpgradeId = string;
export type StoryNodeId = string;
export type StoryChoiceId = string;
export type StoryFlagId = string;

/** Decimal values live in data/save files as strings (`"1.5e30"`). */
export type DecimalString = string;
