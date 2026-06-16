"use strict";

/**
 * Handles dynamic crafting (using the bot's recipe lookup) and smelting
 * via a furnace. Automatically places a crafting table / furnace from
 * inventory if one isn't already nearby.
 */
class CraftingSystem {
  constructor(bot, navigation, inventory, memory) {
    this.bot = bot;
    this.navigation = navigation;
    this.inventory = inventory;
    this.memory = memory;
  }

  findNearbyBlock(name, radius = 16) {
    const block = this.bot.findBlock({
      matching: (b) => b && b.name === name,
      maxDistance: radius,
    });
    return block;
  }

  async ensureCraftingTable() {
    let table = this.findNearbyBlock("crafting_table");
    if (table) {
      await this.navigation.goNearBlock(table, 2).catch(() => null);
      return table;
    }

    if (!this.inventory.hasItem("crafting_table")) {
      return null; // caller should craft/obtain one first
    }

    return this._placeItemNearby("crafting_table");
  }

  async ensureFurnace() {
    let furnace = this.findNearbyBlock("furnace");
    if (furnace) {
      await this.navigation.goNearBlock(furnace, 2).catch(() => null);
      return furnace;
    }

    if (!this.inventory.hasItem("furnace")) {
      return null;
    }

    return this._placeItemNearby("furnace");
  }

  async _placeItemNearby(itemName) {
    const item = this.inventory.getItems().find((i) => i.name === itemName);
    if (!item) return null;

    const refBlock = this.bot.blockAt(this.bot.entity.position.offset(0, -1, 0));
    if (!refBlock) return null;

    try {
      await this.bot.equip(item, "hand");
      const placePos = this.bot.entity.position.offset(1, 0, 0);
      const placeRefBlock = this.bot.blockAt(placePos.offset(0, -1, 0));
      if (!placeRefBlock || placeRefBlock.name === "air") return null;
      await this.bot.placeBlock(placeRefBlock, { x: 0, y: 1, z: 0 });
      this.memory.incrementStat("itemsCrafted", 0);
      return this.findNearbyBlock(itemName, 8);
    } catch (err) {
      return null;
    }
  }

  /**
   * Crafts `count` of `itemName` using mineflayer's dynamic recipe API.
   * Will use a crafting table when the recipe requires one.
   */
  async craftItem(itemName, count = 1) {
    const mcData = require("minecraft-data")(this.bot.version);
    const itemData = mcData.itemsByName[itemName];
    if (!itemData) return false;

    let table = this.bot.findBlock({
      matching: (b) => b && b.name === "crafting_table",
      maxDistance: 8,
    });

    let recipes = this.bot.recipesFor(itemData.id, null, 1, table || null);
    if (recipes.length === 0 && !table) {
      table = await this.ensureCraftingTable();
      recipes = this.bot.recipesFor(itemData.id, null, 1, table || null);
    }

    if (recipes.length === 0) return false;

    const recipe = recipes[0];
    try {
      await this.bot.craft(recipe, count, table || null);
      this.memory.incrementStat("itemsCrafted", count);
      return true;
    } catch (err) {
      return false;
    }
  }

  /** Smelts `inputName` into its smelted output using a furnace and fuel. */
  async smelt(inputName, count, fuelName = "coal") {
    const furnace = await this.ensureFurnace();
    if (!furnace) return false;

    const inputItem = this.inventory.getItems().find((i) => i.name === inputName);
    const fuelItem = this.inventory.getItems().find((i) => i.name === fuelName);
    if (!inputItem || !fuelItem) return false;

    const furnaceWindow = await this.bot.openFurnace(furnace);
    try {
      await furnaceWindow.putFuel(fuelItem.type, null, Math.min(fuelItem.count, count));
      await furnaceWindow.putInput(inputItem.type, null, count);

      await new Promise((resolve) => {
        const timer = setTimeout(resolve, count * 10000 + 5000);
        furnaceWindow.once("update", () => {
          clearTimeout(timer);
          resolve();
        });
      });

      const output = furnaceWindow.outputItem();
      if (output) {
        await furnaceWindow.takeOutput();
      }
      return true;
    } catch (err) {
      return false;
    } finally {
      furnaceWindow.close();
    }
  }

  /** Crafts basic wooden tools assuming enough planks/sticks are available. */
  async craftWoodenToolSet() {
    await this.craftItem("oak_planks", 4);
    await this.craftItem("stick", 4);
    const results = {
      pickaxe: await this.craftItem("wooden_pickaxe", 1),
      axe: await this.craftItem("wooden_axe", 1),
      sword: await this.craftItem("wooden_sword", 1),
    };
    return results;
  }

  async craftStoneToolSet() {
    const results = {
      pickaxe: await this.craftItem("stone_pickaxe", 1),
      axe: await this.craftItem("stone_axe", 1),
      sword: await this.craftItem("stone_sword", 1),
    };
    return results;
  }

  async craftIronToolSet() {
    const results = {
      pickaxe: await this.craftItem("iron_pickaxe", 1),
      axe: await this.craftItem("iron_axe", 1),
      sword: await this.craftItem("iron_sword", 1),
    };
    return results;
  }
}

module.exports = CraftingSystem;
