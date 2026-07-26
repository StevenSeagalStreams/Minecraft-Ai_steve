import type { DecimalString, GeneratorId, ResourceId, StoryFlagId } from './ids';

/**
 * Effects come in two flavours:
 *
 * - *Modifier* effects (`...Multiplier`, `unlockAutomation`, …) are re-derived
 *   every frame from their source (upgrade level, prestige shards, story
 *   choices) — they are never baked into saved state.
 * - *Immediate* effects (`grantResource`, `setStoryFlag`) mutate state once at
 *   the moment they are applied.
 *
 * `isModifierEffect` in `features/effects.ts` is the single source of truth for
 * which bucket a kind falls into.
 */
export type EffectDef =
  | { readonly kind: 'globalProductionMultiplier'; readonly factor: DecimalString }
  | {
      readonly kind: 'resourceProductionMultiplier';
      readonly resource: ResourceId;
      readonly factor: DecimalString;
    }
  /** Flat units/second added to a resource, applied after generator totals. */
  | {
      readonly kind: 'resourceProductionAdditive';
      readonly resource: ResourceId;
      readonly amount: DecimalString;
    }
  | {
      readonly kind: 'generatorProductionMultiplier';
      readonly generator: GeneratorId;
      readonly factor: DecimalString;
    }
  | {
      readonly kind: 'tierProductionMultiplier';
      readonly tier: number;
      readonly factor: DecimalString;
    }
  | {
      readonly kind: 'generatorCostMultiplier';
      readonly generator: GeneratorId;
      readonly factor: DecimalString;
    }
  | { readonly kind: 'globalCostMultiplier'; readonly factor: DecimalString }
  | { readonly kind: 'prestigeGainMultiplier'; readonly factor: DecimalString }
  | { readonly kind: 'offlineEfficiencyBonus'; readonly amount: number }
  | { readonly kind: 'unlockAutomation'; readonly generator: GeneratorId }
  | { readonly kind: 'grantResource'; readonly resource: ResourceId; readonly amount: DecimalString }
  | { readonly kind: 'setStoryFlag'; readonly flag: StoryFlagId; readonly value: boolean };

export type ModifierEffectKind = Extract<
  EffectDef,
  { kind: `${string}Multiplier` } | { kind: 'offlineEfficiencyBonus' } | { kind: 'unlockAutomation' }
>['kind'];
