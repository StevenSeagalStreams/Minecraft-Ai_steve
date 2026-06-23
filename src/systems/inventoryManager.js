"use strict";

const MODULE = "Inventory";

/**
 * Priority weights (higher = never drop / keep in hot-bar).
 * Items not listed get DEFAULT_PRIORITY.
 */
const PRIORITY = {
  // ── Weapons ──────────────────────────
  netherite_sword: 200, diamond_sword: 195, iron_sword: 180, stone_sword: 140, wooden_sword: 100,
  // ── Pickaxes ─────────────────────────
  netherite_pickaxe: 200, diamond_pickaxe: 195, iron_pickaxe: 180, stone_pickaxe: 140, wooden_pickaxe: 100,
  // ── Axes ─────────────────────────────
  netherite_axe: 190, diamond_axe: 185, iron_axe: 175, stone_axe: 135, wooden_axe: 95,
  // ── Armor ────────────────────────────
  netherite_chestplate: 200, diamond_chestplate: 195, iron_chestplate: 180, chain_chestplate: 120,
  netherite_helmet: 200, diamond_helmet: 195, iron_helmet: 180,
  netherite_leggings: 200, diamond_leggings: 195, iron_leggings: 180,
  netherite_boots: 200, diamond_boots: 195, iron_boots: 180,
  // ── Utilities ────────────────────────
  totem_of_undying: 250, crafting_table: 160, furnace: 160, chest: 155,
  // ── Food ─────────────────────────────
  golden_apple: 230, cooked_beef: 120, cooked_porkchop: 120, bread: 110, cooked_chicken: 105,
  apple: 90, carrot: 80, baked_potato: 80,
  // ── Resources ────────────────────────
  diamond: 170, ancient_debris: 180, netherite_ingot: 195,
  iron_ingot: 130, raw_iron: 125, gold_ingot: 120,
  coal: 90, torch: 100, stick: 60, oak_planks: 55,
  oak_log: 50, cobblestone: 40, stone: 40,
  // ── Junk ─────────────────────────────
  rotten_flesh: 5, gravel: 5, sand: 8, dirt: 8, flint: 15,
};

const KEEP_IN_HOTBAR = new Set([
  "wooden_sword","stone_sword","iron_sword","diamond_sword","netherite_sword",
  "wooden_pickaxe","stone_pickaxe","iron_pickaxe","diamond_pickaxe","netherite_pickaxe",
  "iron_axe","diamond_axe",
  "cooked_beef","cooked_porkchop","bread","golden_apple",
  "torch","crafting_table","shield","totem_of_undying",
]);

const JUNK = new Set(["rotten_flesh","gravel","sand","dirt","flint","poisonous_potato"]);
const TOOL_TIERS = ["netherite","diamond","iron","stone","golden","wooden"];

class InventoryManager {
  constructor(bot, config, logger) {
    this.bot    = bot;
    this.config = config;
    this.logger = logger;
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  items()                    { return this.bot.inventory.items(); }
  countOf(name)              { return this.items().filter((i) => i.name === name).reduce((s, i) => s + i.count, 0); }
  has(name, min = 1)         { return this.countOf(name) >= min; }
  emptySlots()               { return this.bot.inventory.emptySlotCount(); }
  totalSlots()               { return this.bot.inventory.slots.length; }
  usedSlotFraction()         { return 1 - this.emptySlots() / this.totalSlots(); }
  isFull()                   { return this.usedSlotFraction() >= this.config.inventory.fullThreshold; }
  isCriticallyFull()         { return this.usedSlotFraction() >= this.config.inventory.criticalFull; }

  getBestTool(toolType) {
    for (const tier of TOOL_TIERS) {
      const item = this.items().find((i) => i.name === `${tier}_${toolType}`);
      if (item) return item;
    }
    return null;
  }

  async equipBestTool(toolType) {
    const tool = this.getBestTool(toolType);
    if (!tool) return null;
    try {
      await this.bot.equip(tool, "hand");
      return tool;
    } catch (_) {
      return null;
    }
  }

  async equipItem(name, destination = "hand") {
    const item = this.items().find((i) => i.name === name);
    if (!item) return false;
    try {
      await this.bot.equip(item, destination);
      return true;
    } catch (_) {
      return false;
    }
  }

  async equipArmor() {
    const slots = [
      { slot: "head",  prefix: "_helmet"     },
      { slot: "torso", prefix: "_chestplate" },
      { slot: "legs",  prefix: "_leggings"   },
      { slot: "feet",  prefix: "_boots"      },
    ];
    for (const { slot, prefix } of slots) {
      for (const tier of TOOL_TIERS) {
        const item = this.items().find((i) => i.name === `${tier}${prefix}`);
        if (item) {
          try { await this.bot.equip(item, slot); } catch (_) {}
          break;
        }
      }
    }
  }

  priorityOf(name) { return PRIORITY[name] ?? 30; }

  itemsToDrop(count = 1) {
    return this.items()
      .filter((i) => JUNK.has(i.name))
      .sort((a, b) => this.priorityOf(a.name) - this.priorityOf(b.name))
      .slice(0, count);
  }

  async dropJunk() {
    const junk = this.itemsToDrop(this.items().length);
    for (const item of junk) {
      try { await this.bot.tossStack(item); } catch (_) {}
    }
    this.logger.debug(MODULE, `Dropped ${junk.length} junk items`);
  }

  async dropLowestPriority(count = 1) {
    const sorted = this.items()
      .filter((i) => !KEEP_IN_HOTBAR.has(i.name))
      .sort((a, b) => this.priorityOf(a.name) - this.priorityOf(b.name));
    for (let i = 0; i < count && i < sorted.length; i++) {
      try { await this.bot.tossStack(sorted[i]); } catch (_) {}
    }
  }

  summarize() {
    const out = {};
    for (const item of this.items()) out[item.name] = (out[item.name] || 0) + item.count;
    return out;
  }
}

module.exports = InventoryManager;
