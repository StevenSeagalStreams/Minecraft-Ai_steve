import { D, type Decimal, ONE, ZERO } from '../../math/decimal';
import { bonusMultiplier, repeatedFactor } from '../../math/scaling';
import type { GameConfig, GeneratorDef } from '../../types/defs';
import type { EffectDef } from '../../types/effects';
import type { GeneratorId, ResourceId } from '../../types/ids';
import type { GameState } from '../../types/state';
import { getRegistry } from '../registry';
import { getShards } from '../resources';

/**
 * Every multiplicative bonus in the game, derived fresh from state + config.
 * Nothing here is persisted: upgrade levels, shard counts and story choices are
 * the source of truth, so rebalancing the data files retroactively fixes saves.
 */
export interface Modifiers {
  readonly globalProduction: Decimal;
  readonly productionByResource: ReadonlyMap<ResourceId, Decimal>;
  /** Flat units/second, added after generator totals rather than scaling them. */
  readonly additiveByResource: ReadonlyMap<ResourceId, Decimal>;
  readonly productionByGenerator: ReadonlyMap<GeneratorId, Decimal>;
  readonly productionByTier: ReadonlyMap<number, Decimal>;
  readonly globalCost: Decimal;
  readonly costByGenerator: ReadonlyMap<GeneratorId, Decimal>;
  readonly prestigeGain: Decimal;
  readonly offlineEfficiencyBonus: number;
  readonly automationUnlocked: ReadonlySet<GeneratorId>;
}

interface MutableModifiers {
  globalProduction: Decimal;
  productionByResource: Map<ResourceId, Decimal>;
  additiveByResource: Map<ResourceId, Decimal>;
  productionByGenerator: Map<GeneratorId, Decimal>;
  productionByTier: Map<number, Decimal>;
  globalCost: Decimal;
  costByGenerator: Map<GeneratorId, Decimal>;
  prestigeGain: Decimal;
  offlineEfficiencyBonus: number;
  automationUnlocked: Set<GeneratorId>;
}

function emptyModifiers(): MutableModifiers {
  return {
    globalProduction: ONE,
    productionByResource: new Map(),
    additiveByResource: new Map(),
    productionByGenerator: new Map(),
    productionByTier: new Map(),
    globalCost: ONE,
    costByGenerator: new Map(),
    prestigeGain: ONE,
    offlineEfficiencyBonus: 0,
    automationUnlocked: new Set(),
  };
}

function multiplyInto<K>(map: Map<K, Decimal>, key: K, factor: Decimal): void {
  map.set(key, (map.get(key) ?? ONE).mul(factor));
}

/**
 * Applies one effect `level` times over. Multiplicative effects compound
 * (`factor ^ level`); additive ones scale linearly. `level` is 1 for one-shot
 * sources such as story choices.
 */
function accumulate(target: MutableModifiers, effect: EffectDef, level: number): void {
  if (level <= 0) return;

  switch (effect.kind) {
    case 'globalProductionMultiplier':
      target.globalProduction = target.globalProduction.mul(repeatedFactor(D(effect.factor), level));
      return;
    case 'resourceProductionMultiplier':
      multiplyInto(
        target.productionByResource,
        effect.resource,
        repeatedFactor(D(effect.factor), level),
      );
      return;
    case 'resourceProductionAdditive':
      // Additive effects scale linearly with level, not exponentially.
      target.additiveByResource.set(
        effect.resource,
        (target.additiveByResource.get(effect.resource) ?? ZERO).add(D(effect.amount).mul(level)),
      );
      return;
    case 'generatorProductionMultiplier':
      multiplyInto(
        target.productionByGenerator,
        effect.generator,
        repeatedFactor(D(effect.factor), level),
      );
      return;
    case 'tierProductionMultiplier':
      multiplyInto(target.productionByTier, effect.tier, repeatedFactor(D(effect.factor), level));
      return;
    case 'globalCostMultiplier':
      target.globalCost = target.globalCost.mul(repeatedFactor(D(effect.factor), level));
      return;
    case 'generatorCostMultiplier':
      multiplyInto(target.costByGenerator, effect.generator, repeatedFactor(D(effect.factor), level));
      return;
    case 'prestigeGainMultiplier':
      target.prestigeGain = target.prestigeGain.mul(repeatedFactor(D(effect.factor), level));
      return;
    case 'offlineEfficiencyBonus':
      target.offlineEfficiencyBonus += effect.amount * level;
      return;
    case 'unlockAutomation':
      target.automationUnlocked.add(effect.generator);
      return;
    default:
      // Immediate effects (grantResource, setStoryFlag) contribute nothing.
      return;
  }
}

export function computeModifiers(state: GameState, config: GameConfig): Modifiers {
  const registry = getRegistry(config);
  const target = emptyModifiers();

  for (const [id, upgradeState] of Object.entries(state.upgrades)) {
    if (upgradeState.level <= 0) continue;
    const def = registry.upgrades.get(id);
    if (def === undefined) continue;
    for (const effect of def.effects) accumulate(target, effect, upgradeState.level);
  }

  for (const record of state.story.history) {
    const node = registry.story.get(record.node);
    const choice = node?.choices.find((option) => option.id === record.choice);
    if (choice === undefined) continue;
    for (const effect of choice.effects) accumulate(target, effect, 1);
  }

  // Shards are a bonus curve rather than an effect list, so they are folded in
  // directly rather than through `accumulate`.
  target.globalProduction = target.globalProduction.mul(
    bonusMultiplier(
      getShards(state, config),
      D(config.prestige.shardBonus),
      config.prestige.shardBonusExponent,
    ),
  );

  return target;
}

/** Combined production multiplier applying to one generator. */
export function generatorMultiplier(modifiers: Modifiers, def: GeneratorDef): Decimal {
  return modifiers.globalProduction
    .mul(modifiers.productionByResource.get(def.produces) ?? ONE)
    .mul(modifiers.productionByGenerator.get(def.id) ?? ONE)
    .mul(modifiers.productionByTier.get(def.tier) ?? ONE);
}

/** Combined cost multiplier applying to one generator's purchases. */
export function costMultiplier(modifiers: Modifiers, generator: GeneratorId): Decimal {
  return modifiers.globalCost.mul(modifiers.costByGenerator.get(generator) ?? ONE);
}
