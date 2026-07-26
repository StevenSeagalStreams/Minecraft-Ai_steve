import type { GameConfig, GeneratorDef, ResourceDef, StoryNode, UpgradeDef } from '../types/defs';
import type { GeneratorId, ResourceId, StoryNodeId, UpgradeId } from '../types/ids';

/**
 * O(1) lookup tables derived from a `GameConfig`.
 *
 * Config objects are immutable module constants, so the derived registry is
 * cached per config instance. `getRegistry` stays a pure function of its
 * argument — same config in, identical registry out — which keeps engine
 * functions deterministic and test-friendly.
 */
export interface ConfigRegistry {
  readonly resources: ReadonlyMap<ResourceId, ResourceDef>;
  readonly generators: ReadonlyMap<GeneratorId, GeneratorDef>;
  readonly upgrades: ReadonlyMap<UpgradeId, UpgradeDef>;
  readonly story: ReadonlyMap<StoryNodeId, StoryNode>;
  /** Generator ids grouped by tier, for tier-wide multipliers. */
  readonly generatorsByTier: ReadonlyMap<number, readonly GeneratorId[]>;
}

const cache = new WeakMap<GameConfig, ConfigRegistry>();

function build(config: GameConfig): ConfigRegistry {
  const generatorsByTier = new Map<number, GeneratorId[]>();
  for (const generator of config.generators) {
    const bucket = generatorsByTier.get(generator.tier);
    if (bucket) bucket.push(generator.id);
    else generatorsByTier.set(generator.tier, [generator.id]);
  }

  return {
    resources: new Map(config.resources.map((def) => [def.id, def])),
    generators: new Map(config.generators.map((def) => [def.id, def])),
    upgrades: new Map(config.upgrades.map((def) => [def.id, def])),
    story: new Map(config.story.map((def) => [def.id, def])),
    generatorsByTier,
  };
}

export function getRegistry(config: GameConfig): ConfigRegistry {
  const cached = cache.get(config);
  if (cached) return cached;
  const registry = build(config);
  cache.set(config, registry);
  return registry;
}
