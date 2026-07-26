import type {
  DecimalString,
  GeneratorId,
  ResourceId,
  StoryFlagId,
  StoryNodeId,
  UpgradeId,
} from './ids';

/**
 * Declarative unlock/trigger predicate. Every gate in the game (generator
 * unlocks, upgrade visibility, story triggers, choice availability) is
 * expressed with this union so logic files never hard-code a check.
 */
export type ConditionDef =
  | { readonly kind: 'always' }
  | { readonly kind: 'never' }
  | { readonly kind: 'resourceAtLeast'; readonly resource: ResourceId; readonly amount: DecimalString }
  | {
      readonly kind: 'lifetimeResourceAtLeast';
      readonly resource: ResourceId;
      readonly amount: DecimalString;
    }
  | {
      readonly kind: 'runResourceAtLeast';
      readonly resource: ResourceId;
      readonly amount: DecimalString;
    }
  | {
      readonly kind: 'generatorCountAtLeast';
      readonly generator: GeneratorId;
      readonly count: DecimalString;
    }
  | { readonly kind: 'upgradeLevelAtLeast'; readonly upgrade: UpgradeId; readonly level: number }
  | { readonly kind: 'prestigeCountAtLeast'; readonly count: number }
  | { readonly kind: 'shardsAtLeast'; readonly amount: DecimalString }
  | { readonly kind: 'storyFlag'; readonly flag: StoryFlagId; readonly value: boolean }
  | { readonly kind: 'storyNodeSeen'; readonly node: StoryNodeId }
  | { readonly kind: 'runTimeAtLeast'; readonly ms: number }
  | { readonly kind: 'totalTimeAtLeast'; readonly ms: number }
  | { readonly kind: 'all'; readonly conditions: readonly ConditionDef[] }
  | { readonly kind: 'any'; readonly conditions: readonly ConditionDef[] }
  | { readonly kind: 'not'; readonly condition: ConditionDef };
