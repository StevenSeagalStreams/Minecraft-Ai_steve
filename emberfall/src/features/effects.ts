import { D } from '../math/decimal';
import type { EffectDef } from '../types/effects';
import type { GameState } from '../types/state';
import { addResource } from './resources';

/**
 * Modifier effects are re-derived from their source every frame
 * (see `upgrades/modifiers.ts`); immediate effects change state exactly once,
 * at the moment they are applied. Splitting them here keeps saves free of
 * duplicated config data.
 */
export function isModifierEffect(effect: EffectDef): boolean {
  switch (effect.kind) {
    case 'grantResource':
    case 'setStoryFlag':
      return false;
    default:
      return true;
  }
}

function applyImmediateEffect(state: GameState, effect: EffectDef): GameState {
  switch (effect.kind) {
    case 'grantResource':
      return addResource(state, effect.resource, D(effect.amount));
    case 'setStoryFlag':
      return {
        ...state,
        story: {
          ...state.story,
          flags: { ...state.story.flags, [effect.flag]: effect.value },
        },
      };
    default:
      // Modifier effects are derived, not applied — nothing to write.
      return state;
  }
}

export function applyImmediateEffects(
  state: GameState,
  effects: readonly EffectDef[],
): GameState {
  return effects.reduce(applyImmediateEffect, state);
}
