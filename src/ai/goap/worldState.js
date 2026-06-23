"use strict";

/**
 * GOAP World State — a flat key/value snapshot of everything the planner
 * needs to reason about. Values are booleans, numbers, or strings.
 *
 * Keys are deliberately simple to keep the planner fast.
 */
class WorldState {
  constructor(values = {}) {
    this._v = { ...values };
  }

  get(key)         { return this._v[key]; }
  set(key, value)  { this._v[key] = value; return this; }
  has(key)         { return key in this._v; }
  clone()          { return new WorldState({ ...this._v }); }
  matches(other)   {
    for (const [k, v] of Object.entries(other._v)) {
      if (this._v[k] !== v) return false;
    }
    return true;
  }
  equals(other)    {
    const ak = Object.keys(this._v);
    const bk = Object.keys(other._v);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => this._v[k] === other._v[k]);
  }
  toJSON()         { return { ...this._v }; }
}

/**
 * Builds a WorldState from the current live state of all subsystems.
 * Called at the start of each GOAP planning cycle.
 */
function capture(bot, inventory, memory, perception, baseManager) {
  const snap = perception.last;
  const inv  = inventory.summarize();

  return new WorldState({
    // ── Survival ──────────────────────────────────────────────────────
    health:             bot.health,
    food:               bot.food,
    isAlive:            true,
    isCriticalHealth:   bot.health <= 5,
    isLowHealth:        bot.health <= 8,
    isHungry:           bot.food < 12,
    isStarving:         bot.food < 6,
    hasFood:            (inv["bread"] || 0) + (inv["cooked_beef"] || 0) + (inv["cooked_porkchop"] || 0) > 0,
    hasFoodReserve:     ((inv["bread"] || 0) + (inv["cooked_beef"] || 0)) >= 8,

    // ── Threats ───────────────────────────────────────────────────────
    isNight:            snap?.isNight ?? false,
    hostileMobNearby:   (snap?.hostileMobs?.length ?? 0) > 0,
    wardenNearby:       snap?.hostileMobs?.some((m) => m.name === "warden") ?? false,
    inBase:             baseManager.isNearBase(),

    // ── Inventory ─────────────────────────────────────────────────────
    inventoryFull:      inventory.isFull(),
    hasWood:            (inv["oak_log"] || 0) + (inv["birch_log"] || 0) >= 4,
    hasStone:           (inv["cobblestone"] || 0) >= 4,
    hasCoal:            (inv["coal"] || 0) + (inv["charcoal"] || 0) >= 1,
    hasIronIngot:       (inv["iron_ingot"] || 0) >= 2,
    hasDiamond:         (inv["diamond"] || 0) >= 2,
    hasRawIron:         (inv["raw_iron"] || 0) >= 1,

    // ── Tools & Armor ─────────────────────────────────────────────────
    hasWoodenPickaxe:   inventory.has("wooden_pickaxe"),
    hasWoodenSword:     inventory.has("wooden_sword"),
    hasStonePickaxe:    inventory.has("stone_pickaxe"),
    hasStoneSword:      inventory.has("stone_sword"),
    hasIronPickaxe:     inventory.has("iron_pickaxe"),
    hasIronSword:       inventory.has("iron_sword"),
    hasDiamondPickaxe:  inventory.has("diamond_pickaxe"),
    hasIronArmor:       inventory.has("iron_chestplate"),
    hasDiamondArmor:    inventory.has("diamond_chestplate"),
    hasShield:          inventory.has("shield"),
    hasCraftingTable:   inventory.has("crafting_table") || !!snap?.craftingTables?.length,
    hasFurnace:         !!snap?.furnaces?.length,
    hasBed:             inventory.has("white_bed") || !!snap?.beds?.length,
    hasTorch:           (inv["torch"] || 0) >= 1,

    // ── Base ──────────────────────────────────────────────────────────
    hasBase:            memory.hasBase(),
    basePhase:          memory.base?.phase ?? 0,
    hasChest:           memory.chests.length > 0,
    hasFarm:            memory.data?.farms?.length > 0,

    // ── Progression ───────────────────────────────────────────────────
    hasEnchantingTable: !!snap?.craftingTables?.some((b) => b.name === "enchanting_table"),
    dimension:          snap?.dimension ?? "overworld",
  });
}

module.exports = { WorldState, capture };
