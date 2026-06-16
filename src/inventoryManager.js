"use strict";

// Priority weights: higher = keep, lower = drop first when inventory is full.
const ITEM_PRIORITY = {
  diamond: 100,
  iron_ingot: 90,
  raw_iron: 88,
  coal: 70,
  iron_pickaxe: 95,
  iron_axe: 92,
  iron_sword: 92,
  stone_pickaxe: 60,
  stone_axe: 58,
  stone_sword: 58,
  wooden_pickaxe: 40,
  wooden_axe: 38,
  wooden_sword: 38,
  crafting_table: 80,
  furnace: 80,
  chest: 75,
  cobblestone: 50,
  oak_log: 45,
  oak_planks: 35,
  stick: 30,
  bread: 65,
  cooked_beef: 65,
  cooked_porkchop: 65,
  apple: 60,
  torch: 55,
};

const DEFAULT_PRIORITY = 20;
const JUNK_ITEMS = new Set(["rotten_flesh", "spider_eye", "gravel", "sand", "dirt", "flint"]);

class InventoryManager {
  constructor(bot, config) {
    this.bot = bot;
    this.config = config;
  }

  getItems() {
    return this.bot.inventory.items();
  }

  countItem(name) {
    return this.getItems()
      .filter((i) => i.name === name)
      .reduce((sum, i) => sum + i.count, 0);
  }

  hasItem(name, minCount = 1) {
    return this.countItem(name) >= minCount;
  }

  getEmptySlotCount() {
    return this.bot.inventory.emptySlotCount();
  }

  isFull() {
    const total = this.bot.inventory.slots.length;
    const used = total - this.getEmptySlotCount();
    return used / total >= this.config.inventoryFullThreshold;
  }

  /** Returns the best tool the bot owns for a given dig/attack purpose. */
  getBestTool(toolType) {
    // toolType: "pickaxe" | "axe" | "sword" | "shovel" | "hoe"
    const tiers = ["netherite", "diamond", "iron", "stone", "golden", "wooden"];
    for (const tier of tiers) {
      const item = this.getItems().find((i) => i.name === `${tier}_${toolType}`);
      if (item) return item;
    }
    return null;
  }

  async equipBestTool(toolType) {
    const tool = this.getBestTool(toolType);
    if (tool) {
      await this.bot.equip(tool, "hand");
      return tool;
    }
    return null;
  }

  /** Picks low-priority junk items to drop to make room. */
  getItemsToDrop(count = 1) {
    const items = this.getItems()
      .filter((i) => JUNK_ITEMS.has(i.name))
      .sort((a, b) => this._priority(a.name) - this._priority(b.name));
    return items.slice(0, count);
  }

  _priority(name) {
    return ITEM_PRIORITY[name] ?? DEFAULT_PRIORITY;
  }

  /** Returns items sorted by ascending priority (good candidates to store/drop first). */
  getLowPriorityItems() {
    return this.getItems().sort((a, b) => this._priority(a.name) - this._priority(b.name));
  }

  async tossJunk() {
    const junk = this.getItemsToDrop(this.getItems().length);
    for (const item of junk) {
      try {
        await this.bot.tossStack(item);
      } catch (_) {
        // ignore failures
      }
    }
  }

  summarize() {
    const items = this.getItems();
    const summary = {};
    for (const item of items) {
      summary[item.name] = (summary[item.name] || 0) + item.count;
    }
    return summary;
  }
}

module.exports = InventoryManager;
