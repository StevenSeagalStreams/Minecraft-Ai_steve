import { createInitialState } from '../features/gameState';
import { applyUnlocks } from '../features/unlocks';
import { deserializeDecimal, serializeDecimal } from '../math/decimal';
import type { GameConfig } from '../types/defs';
import type { GeneratorId, ResourceId, UpgradeId } from '../types/ids';
import type {
  SerializedGameState,
  SerializedGeneratorState,
  SerializedResourceState,
  SerializedUpgradeState,
} from '../types/save';
import type {
  GameState,
  GeneratorState,
  ResourceState,
  StoryChoiceRecord,
  UpgradeState,
} from '../types/state';

/**
 * `Decimal` does not survive a JSON round-trip. It *stringifies* fine — the
 * class defines `toJSON` — which is exactly the trap: the value parses back as
 * a plain string with no methods, and the first `.mul()` on it throws.
 *
 * Every numeric field therefore crosses the storage boundary as an explicit
 * string, and `deserializeGameState` is the only place strings become `Decimal`
 * again. Nothing else may spread persisted data into live state.
 */
export function serializeGameState(state: GameState): SerializedGameState {
  const resources: Record<ResourceId, SerializedResourceState> = {};
  for (const [id, resource] of Object.entries(state.resources)) {
    resources[id] = {
      amount: serializeDecimal(resource.amount),
      lifetimeEarned: serializeDecimal(resource.lifetimeEarned),
      runEarned: serializeDecimal(resource.runEarned),
      unlocked: resource.unlocked,
    };
  }

  const generators: Record<GeneratorId, SerializedGeneratorState> = {};
  for (const [id, generator] of Object.entries(state.generators)) {
    generators[id] = {
      owned: serializeDecimal(generator.owned),
      lifetimePurchased: serializeDecimal(generator.lifetimePurchased),
      unlocked: generator.unlocked,
      automationEnabled: generator.automationEnabled,
    };
  }

  const upgrades: Record<UpgradeId, SerializedUpgradeState> = {};
  for (const [id, upgrade] of Object.entries(state.upgrades)) {
    upgrades[id] = { level: upgrade.level, unlocked: upgrade.unlocked };
  }

  return {
    resources,
    generators,
    upgrades,
    prestige: {
      count: state.prestige.count,
      lifetimeShards: serializeDecimal(state.prestige.lifetimeShards),
      bestRunTotal: serializeDecimal(state.prestige.bestRunTotal),
      lastAscensionAt: state.prestige.lastAscensionAt,
    },
    story: {
      seenNodes: [...state.story.seenNodes],
      queue: [...state.story.queue],
      activeNode: state.story.activeNode,
      flags: { ...state.story.flags },
      history: [...state.story.history],
    },
    stats: { ...state.stats },
    lastTickAt: state.lastTickAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readHistory(value: unknown): StoryChoiceRecord[] {
  if (!Array.isArray(value)) return [];
  const records: StoryChoiceRecord[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    if (typeof entry.node !== 'string' || typeof entry.choice !== 'string') continue;
    records.push({
      node: entry.node,
      choice: entry.choice,
      atRun: readNumber(entry.atRun, 0),
      atMs: readNumber(entry.atMs, 0),
    });
  }
  return records;
}

function readFlags(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  const flags: Record<string, boolean> = {};
  for (const [key, flag] of Object.entries(value)) {
    if (typeof flag === 'boolean') flags[key] = flag;
  }
  return flags;
}

/**
 * Rebuilds a live `GameState` from persisted data.
 *
 * A pristine state is built from the *current* config first and the save is
 * layered on top, so content added in an update appears with sane defaults and
 * content removed from the config is dropped rather than lingering as a
 * half-typed object. Unparseable fields fall back instead of throwing — a
 * corrupt save costs the player a field, not their whole run.
 */
export function deserializeGameState(
  raw: unknown,
  config: GameConfig,
  now: number,
): GameState {
  const base = createInitialState(config, now);
  if (!isRecord(raw)) return base;

  const rawResources = isRecord(raw.resources) ? raw.resources : {};
  const resources: Record<ResourceId, ResourceState> = {};
  for (const [id, fallback] of Object.entries(base.resources)) {
    const stored = rawResources[id];
    if (!isRecord(stored)) {
      resources[id] = fallback;
      continue;
    }
    resources[id] = {
      amount: deserializeDecimal(stored.amount, fallback.amount),
      lifetimeEarned: deserializeDecimal(stored.lifetimeEarned, fallback.lifetimeEarned),
      runEarned: deserializeDecimal(stored.runEarned, fallback.runEarned),
      unlocked: readBoolean(stored.unlocked, fallback.unlocked),
    };
  }

  const rawGenerators = isRecord(raw.generators) ? raw.generators : {};
  const generators: Record<GeneratorId, GeneratorState> = {};
  for (const [id, fallback] of Object.entries(base.generators)) {
    const stored = rawGenerators[id];
    if (!isRecord(stored)) {
      generators[id] = fallback;
      continue;
    }
    generators[id] = {
      owned: deserializeDecimal(stored.owned, fallback.owned),
      lifetimePurchased: deserializeDecimal(stored.lifetimePurchased, fallback.lifetimePurchased),
      unlocked: readBoolean(stored.unlocked, fallback.unlocked),
      automationEnabled: readBoolean(stored.automationEnabled, fallback.automationEnabled),
    };
  }

  const rawUpgrades = isRecord(raw.upgrades) ? raw.upgrades : {};
  const upgrades: Record<UpgradeId, UpgradeState> = {};
  for (const [id, fallback] of Object.entries(base.upgrades)) {
    const stored = rawUpgrades[id];
    if (!isRecord(stored)) {
      upgrades[id] = fallback;
      continue;
    }
    upgrades[id] = {
      level: Math.max(0, Math.floor(readNumber(stored.level, fallback.level))),
      unlocked: readBoolean(stored.unlocked, fallback.unlocked),
    };
  }

  const rawPrestige = isRecord(raw.prestige) ? raw.prestige : {};
  const rawStory = isRecord(raw.story) ? raw.story : {};
  const rawStats = isRecord(raw.stats) ? raw.stats : {};
  const activeNode = typeof rawStory.activeNode === 'string' ? rawStory.activeNode : null;

  const state: GameState = {
    resources,
    generators,
    upgrades,
    prestige: {
      count: Math.max(0, Math.floor(readNumber(rawPrestige.count, 0))),
      lifetimeShards: deserializeDecimal(rawPrestige.lifetimeShards, base.prestige.lifetimeShards),
      bestRunTotal: deserializeDecimal(rawPrestige.bestRunTotal, base.prestige.bestRunTotal),
      lastAscensionAt: readNumber(rawPrestige.lastAscensionAt, now),
    },
    story: {
      seenNodes: readStringArray(rawStory.seenNodes),
      queue: readStringArray(rawStory.queue),
      activeNode,
      flags: readFlags(rawStory.flags),
      history: readHistory(rawStory.history),
    },
    stats: {
      totalPlayTimeMs: readNumber(rawStats.totalPlayTimeMs, 0),
      runPlayTimeMs: readNumber(rawStats.runPlayTimeMs, 0),
      totalTicks: readNumber(rawStats.totalTicks, 0),
      lastOfflineMs: readNumber(rawStats.lastOfflineMs, 0),
      createdAt: readNumber(rawStats.createdAt, now),
    },
    lastTickAt: readNumber(raw.lastTickAt, now),
  };

  // Content added since the save was written may already qualify for unlock.
  return applyUnlocks(state, config);
}
