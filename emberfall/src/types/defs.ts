import type { ConditionDef } from './conditions';
import type { EffectDef } from './effects';
import type {
  DecimalString,
  GeneratorId,
  ResourceId,
  StoryChoiceId,
  StoryNodeId,
  UpgradeId,
} from './ids';

/** How the price of the Nth purchase is derived. */
export type CostCurveDef =
  | {
      readonly kind: 'exponential';
      readonly resource: ResourceId;
      readonly base: DecimalString;
      readonly growth: DecimalString;
    }
  | {
      readonly kind: 'polynomial';
      readonly resource: ResourceId;
      readonly base: DecimalString;
      readonly exponent: number;
    }
  | {
      readonly kind: 'linear';
      readonly resource: ResourceId;
      readonly base: DecimalString;
      readonly step: DecimalString;
    };

export interface ResourceDef {
  readonly id: ResourceId;
  readonly name: string;
  readonly shortName: string;
  readonly description: string;
  readonly icon: string;
  readonly startingAmount: DecimalString;
  /** Survives ascension untouched (meta-currencies). */
  readonly persistent: boolean;
  readonly unlockedAtStart: boolean;
  readonly unlock: ConditionDef | null;
}

export interface GeneratorDef {
  readonly id: GeneratorId;
  readonly name: string;
  readonly description: string;
  /** 1-based; used by tier-wide multiplier effects and UI ordering. */
  readonly tier: number;
  readonly produces: ResourceId;
  /** Units produced per second by one generator before any multiplier. */
  readonly baseRate: DecimalString;
  readonly cost: CostCurveDef;
  readonly unlock: ConditionDef | null;
  readonly unlockedAtStart: boolean;
}

export type UpgradeCategory = 'production' | 'automation' | 'prestige' | 'story';

export interface UpgradeDef {
  readonly id: UpgradeId;
  readonly name: string;
  readonly description: string;
  readonly category: UpgradeCategory;
  readonly cost: CostCurveDef;
  /** `Number.POSITIVE_INFINITY` for endlessly repeatable upgrades. */
  readonly maxLevel: number;
  /** Multiplicative factors are raised to the level, additive ones scaled by it. */
  readonly effects: readonly EffectDef[];
  readonly unlock: ConditionDef | null;
  readonly requires: readonly UpgradeId[];
  /** Kept through ascension (meta upgrades bought with shards). */
  readonly persistent: boolean;
}

export interface StoryChoice {
  readonly id: StoryChoiceId;
  readonly text: string;
  readonly flavour: string | null;
  readonly requires: ConditionDef | null;
  readonly effects: readonly EffectDef[];
  readonly nextNode: StoryNodeId | null;
}

export interface StoryNode {
  readonly id: StoryNodeId;
  readonly chapter: number;
  readonly title: string;
  readonly speaker: string | null;
  readonly body: string;
  /** `null` means the node is only reachable as another node's `nextNode`. */
  readonly trigger: ConditionDef | null;
  /**
   * Every node is shown at most once per run. When this is true, ascension
   * clears it from the seen list so the beat can play again in the next run.
   */
  readonly repeatAfterPrestige: boolean;
  readonly choices: readonly StoryChoice[];
}

export interface PrestigeConfigDef {
  /** Meta-currency awarded on ascension. */
  readonly currency: ResourceId;
  /** Run total of this resource drives the reward. */
  readonly sourceResource: ResourceId;
  /** Minimum run total before ascension is allowed. */
  readonly requirement: DecimalString;
  /** shards = gainMultiplier * (runTotal / divisor) ^ exponent */
  readonly divisor: DecimalString;
  readonly exponent: number;
  readonly gainMultiplier: DecimalString;
  /** Global production bonus = 1 + shardBonus * shards ^ shardBonusExponent */
  readonly shardBonus: DecimalString;
  readonly shardBonusExponent: number;
}

export interface OfflineConfigDef {
  /** Elapsed spans shorter than this are ignored (treated as a normal tick). */
  readonly minElapsedMs: number;
  /** Hard cap on credited offline time. */
  readonly maxElapsedMs: number;
  /** Base fraction of online output earned while away (0..1). */
  readonly efficiency: number;
  /** Simulation granularity; widened automatically to respect `maxSteps`. */
  readonly stepMs: number;
  readonly maxSteps: number;
  /** Automation is allowed to run during offline catch-up. */
  readonly automationEnabled: boolean;
}

export interface TimeConfigDef {
  /** Target engine step; the loop hook aims for this cadence. */
  readonly tickIntervalMs: number;
  /** Largest delta a single online tick may integrate. */
  readonly maxTickMs: number;
  /** Backward clock movement beyond this is treated as tampering, not lag. */
  readonly maxBackwardDriftMs: number;
  /** Forward jumps beyond this are routed through offline progress instead. */
  readonly maxForwardDriftMs: number;
}

export type NumberNotation = 'standard' | 'scientific' | 'engineering';

export interface FormattingConfigDef {
  readonly notation: NumberNotation;
  /** Below this magnitude numbers are printed plainly (`1,234`). */
  readonly plainBelow: DecimalString;
  readonly decimalPlaces: number;
  readonly smallDecimalPlaces: number;
  /** Separator between mantissa and suffix (`"1.23 QaDc"`). */
  readonly suffixSeparator: string;
  readonly groupSeparator: string;
}

export interface BulkBuyConfigDef {
  readonly options: readonly number[];
  /** Sentinel meaning "buy as many as affordable". */
  readonly maxOption: number;
  readonly defaultOption: number;
}

export interface ManualGatherConfigDef {
  readonly resource: ResourceId;
  readonly baseAmount: DecimalString;
  /** Each tap is also worth this many seconds of current production. */
  readonly secondsOfProduction: number;
}

export interface PersistenceConfigDef {
  readonly storageKey: string;
  /**
   * Minimum gap between writes. The engine ticks far faster than a save is
   * worth writing, so writes are throttled and flushed on backgrounding.
   */
  readonly saveIntervalMs: number;
}

export interface GameConfig {
  readonly resources: readonly ResourceDef[];
  readonly generators: readonly GeneratorDef[];
  readonly upgrades: readonly UpgradeDef[];
  readonly story: readonly StoryNode[];
  readonly prestige: PrestigeConfigDef;
  readonly offline: OfflineConfigDef;
  readonly time: TimeConfigDef;
  readonly formatting: FormattingConfigDef;
  readonly bulkBuy: BulkBuyConfigDef;
  readonly manualGather: ManualGatherConfigDef;
  readonly persistence: PersistenceConfigDef;
}
