import type Decimal from 'break_infinity.js';
import type {
  GeneratorId,
  ResourceId,
  StoryChoiceId,
  StoryFlagId,
  StoryNodeId,
  UpgradeId,
} from './ids';

export interface ResourceState {
  readonly amount: Decimal;
  /** Total ever produced, across all runs. */
  readonly lifetimeEarned: Decimal;
  /** Total produced since the last ascension — drives prestige rewards. */
  readonly runEarned: Decimal;
  readonly unlocked: boolean;
}

export interface GeneratorState {
  readonly owned: Decimal;
  readonly lifetimePurchased: Decimal;
  readonly unlocked: boolean;
  /** Player toggle; only meaningful once automation is unlocked. */
  readonly automationEnabled: boolean;
}

export interface UpgradeState {
  readonly level: number;
  readonly unlocked: boolean;
}

export interface PrestigeState {
  readonly count: number;
  readonly shards: Decimal;
  readonly lifetimeShards: Decimal;
  /** Best single-run source-resource total, for UI and achievements. */
  readonly bestRunTotal: Decimal;
  readonly lastAscensionAt: number;
}

export interface StoryChoiceRecord {
  readonly node: StoryNodeId;
  readonly choice: StoryChoiceId;
  readonly atRun: number;
  readonly atMs: number;
}

export interface StoryState {
  readonly seenNodes: readonly StoryNodeId[];
  /** FIFO queue of triggered-but-unread nodes. */
  readonly queue: readonly StoryNodeId[];
  readonly activeNode: StoryNodeId | null;
  readonly flags: Readonly<Record<StoryFlagId, boolean>>;
  readonly history: readonly StoryChoiceRecord[];
}

export interface StatsState {
  readonly totalPlayTimeMs: number;
  readonly runPlayTimeMs: number;
  readonly totalTicks: number;
  readonly lastOfflineMs: number;
  readonly createdAt: number;
}

export interface GameState {
  readonly resources: Readonly<Record<ResourceId, ResourceState>>;
  readonly generators: Readonly<Record<GeneratorId, GeneratorState>>;
  readonly upgrades: Readonly<Record<UpgradeId, UpgradeState>>;
  readonly prestige: PrestigeState;
  readonly story: StoryState;
  readonly stats: StatsState;
  /**
   * Wall-clock stamp of the last engine step. Written by the caller (store /
   * hook) — engine functions never read the clock themselves.
   */
  readonly lastTickAt: number;
}
