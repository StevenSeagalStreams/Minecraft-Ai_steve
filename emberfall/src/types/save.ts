import type { DecimalString, GeneratorId, ResourceId, StoryFlagId, UpgradeId } from './ids';
import type { StatsState, StoryChoiceRecord } from './state';

/**
 * Persisted mirror of `GameState` with every `Decimal` flattened to a string.
 * `Decimal` does not survive `JSON.stringify`, so the persist layer converts in
 * both directions and nothing else in the app touches these shapes.
 */
export interface SerializedResourceState {
  readonly amount: DecimalString;
  readonly lifetimeEarned: DecimalString;
  readonly runEarned: DecimalString;
  readonly unlocked: boolean;
}

export interface SerializedGeneratorState {
  readonly owned: DecimalString;
  readonly lifetimePurchased: DecimalString;
  readonly unlocked: boolean;
  readonly automationEnabled: boolean;
}

export interface SerializedUpgradeState {
  readonly level: number;
  readonly unlocked: boolean;
}

export interface SerializedPrestigeState {
  readonly count: number;
  readonly lifetimeShards: DecimalString;
  readonly bestRunTotal: DecimalString;
  readonly lastAscensionAt: number;
}

export interface SerializedStoryState {
  readonly seenNodes: readonly string[];
  readonly queue: readonly string[];
  readonly activeNode: string | null;
  readonly flags: Readonly<Record<StoryFlagId, boolean>>;
  readonly history: readonly StoryChoiceRecord[];
}

export interface SerializedGameState {
  readonly resources: Readonly<Record<ResourceId, SerializedResourceState>>;
  readonly generators: Readonly<Record<GeneratorId, SerializedGeneratorState>>;
  readonly upgrades: Readonly<Record<UpgradeId, SerializedUpgradeState>>;
  readonly prestige: SerializedPrestigeState;
  readonly story: SerializedStoryState;
  readonly stats: StatsState;
  readonly lastTickAt: number;
}

export interface SaveFile {
  readonly version: number;
  readonly savedAt: number;
  readonly state: SerializedGameState;
}

/** Shape of a save before its version has been checked/migrated. */
export type UnknownSaveFile = {
  readonly version: number;
  readonly savedAt: number;
  readonly state: unknown;
};
