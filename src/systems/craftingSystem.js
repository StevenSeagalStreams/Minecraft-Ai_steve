"use strict";

const { CRAFTING_RECIPES, SMELT_RECIPES, FUEL_VALUES, resolve, craftingPath } = require("./craftingGraph");
const MODULE = "Crafting";

/**
 * Executes crafting and smelting plans derived from the crafting graph.
 * Automatically places/uses crafting tables and furnaces.
 */
class CraftingSystem {
  constructor(bot, navigation, inventory, memory, logger, eventBus) {
    this.bot       = bot;
    this.navigation = navigation;
    this.inventory = inventory;
    this.memory    = memory;
    this.logger    = logger;
    this.eventBus  = eventBus;
  }

  // ─── Crafting table ───────────────────────────────────────────────────────

  async ensureCraftingTable() {
    let table = this._findNearby("crafting_table");
    if (table) {
      await this.navigation.goToBlock(table, 2).catch(() => null);
      return table;
    }
    if (!this.inventory.has("crafting_table")) {
      // Try to craft one if we have planks
      if (this.inventory.has("oak_planks", 4)) {
        await this._craftSimple("crafting_table", 1, null);
      } else if (this.inventory.has("oak_log", 1)) {
        await this._craftSimple("oak_planks", 4, null);
        await this._craftSimple("crafting_table", 1, null);
      } else {
        return null;
      }
    }
    return this._placeBlock("crafting_table", { x: 1, y: 0, z: 0 });
  }

  async ensureFurnace() {
    let furnace = this._findNearby("furnace");
    if (furnace) {
      await this.navigation.goToBlock(furnace, 2).catch(() => null);
      return furnace;
    }
    if (!this.inventory.has("furnace")) {
      if (!this.inventory.has("cobblestone", 8)) return null;
      const table = await this.ensureCraftingTable();
      if (!table) return null;
      await this._craftSimple("furnace", 1, table);
    }
    return this._placeBlock("furnace", { x: -1, y: 0, z: 0 });
  }

  _findNearby(name, radius = 16) {
    return this.bot.findBlock({ matching: (b) => b?.name === name, maxDistance: radius });
  }

  async _placeBlock(itemName, faceVec) {
    const item = this.inventory.items().find((i) => i.name === itemName);
    if (!item) return null;
    const refBlock = this.bot.blockAt(this.bot.entity.position.offset(faceVec.x, -1, faceVec.z));
    if (!refBlock || refBlock.name === "air") return null;
    try {
      await this.bot.equip(item, "hand");
      await this.bot.placeBlock(refBlock, { x: 0, y: 1, z: 0 });
      await this._sleep(500);
      return this._findNearby(itemName, 4);
    } catch (err) {
      this.logger.warn(MODULE, `Failed to place ${itemName}: ${err.message}`);
      return null;
    }
  }

  // ─── Crafting ─────────────────────────────────────────────────────────────

  /**
   * High-level: craft `itemName` × `count`. Resolves the full dependency
   * tree automatically, crafting prerequisites as needed.
   */
  async craft(itemName, count = 1) {
    this.logger.info(MODULE, `Crafting ${count}x ${itemName}`);
    const path = craftingPath(itemName, this.inventory);
    path.push(itemName);

    for (const step of path) {
      const recipe = CRAFTING_RECIPES[step];
      if (!recipe) continue;
      const need = _howMany(this.inventory, step, step === itemName ? count : 1);
      if (need <= 0) continue;
      const batches = Math.ceil(need / recipe.yields);
      const ok = await this._craftSimpleWithTable(step, batches);
      if (!ok) {
        this.logger.warn(MODULE, `Failed to craft ${step}`);
        return false;
      }
    }
    this.eventBus.emit("craft:complete", { item: itemName, count });
    this.memory.increment("itemsCrafted", count);
    return true;
  }

  async _craftSimpleWithTable(itemName, batches) {
    const recipe = CRAFTING_RECIPES[itemName];
    if (!recipe) return false;

    let table = null;
    if (recipe.needsTable) {
      table = await this.ensureCraftingTable();
      if (!table) return false;
    }

    return this._craftSimple(itemName, batches, table);
  }

  async _craftSimple(itemName, batches, craftingTable) {
    const mcData = require("minecraft-data")(this.bot.version);
    const itemData = mcData.itemsByName[itemName];
    if (!itemData) return false;

    const recipes = this.bot.recipesFor(itemData.id, null, 1, craftingTable ?? null);
    if (!recipes.length) return false;

    try {
      await this.bot.craft(recipes[0], batches, craftingTable ?? null);
      return true;
    } catch (err) {
      this.logger.warn(MODULE, `bot.craft failed for ${itemName}: ${err.message}`);
      return false;
    }
  }

  // ─── Smelting ─────────────────────────────────────────────────────────────

  async smelt(inputName, count) {
    const smeltRecipe = SMELT_RECIPES[inputName];
    if (!smeltRecipe) {
      this.logger.warn(MODULE, `No smelt recipe for ${inputName}`);
      return false;
    }
    if (!this.inventory.has(inputName, count)) return false;

    // Ensure we have fuel
    const fuelNeeded = Math.ceil(count * smeltRecipe.fuelCost);
    const fuel = this._pickFuel(fuelNeeded);
    if (!fuel) {
      this.logger.warn(MODULE, "No fuel for smelting");
      return false;
    }

    const furnaceBlock = await this.ensureFurnace();
    if (!furnaceBlock) return false;

    const inputItem = this.inventory.items().find((i) => i.name === inputName);
    const fuelItem  = this.inventory.items().find((i) => i.name === fuel.name);
    if (!inputItem || !fuelItem) return false;

    try {
      const furnaceWindow = await this.bot.openFurnace(furnaceBlock);
      await furnaceWindow.putFuel(fuelItem.type, null, Math.min(fuelItem.count, fuel.amount));
      await furnaceWindow.putInput(inputItem.type, null, count);

      // Wait for output (timeout = count * 10s + buffer)
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, count * 10500 + 5000);
        furnaceWindow.once("update", () => { clearTimeout(timeout); resolve(); });
      });

      try { await furnaceWindow.takeOutput(); } catch (_) {}
      furnaceWindow.close();
      this.logger.info(MODULE, `Smelted ${count}x ${inputName} → ${smeltRecipe.output}`);
      return true;
    } catch (err) {
      this.logger.error(MODULE, `Smelt failed: ${err.message}`);
      return false;
    }
  }

  _pickFuel(unitsNeeded) {
    for (const [name, value] of Object.entries(FUEL_VALUES)) {
      const count = this.inventory.countOf(name);
      if (count > 0) {
        const amount = Math.ceil(unitsNeeded / value);
        if (count >= amount) return { name, amount };
      }
    }
    return null;
  }

  // ─── Convenience tool set builders ───────────────────────────────────────

  async craftWoodenTools() {
    await this.craft("oak_planks", 8);
    await this.craft("stick", 4);
    await this.craft("crafting_table", 1);
    await this.craft("wooden_pickaxe", 1);
    await this.craft("wooden_axe", 1);
    await this.craft("wooden_sword", 1);
  }

  async craftStoneTools() {
    await this.craft("stone_pickaxe", 1);
    await this.craft("stone_axe", 1);
    await this.craft("stone_sword", 1);
  }

  async craftIronTools() {
    if (this.inventory.has("raw_iron")) {
      await this.smelt("raw_iron", this.inventory.countOf("raw_iron"));
    }
    await this.craft("iron_pickaxe", 1);
    await this.craft("iron_axe", 1);
    await this.craft("iron_sword", 1);
  }

  async craftFullIronArmor() {
    if (this.inventory.has("raw_iron")) {
      await this.smelt("raw_iron", this.inventory.countOf("raw_iron"));
    }
    await this.craft("iron_helmet", 1);
    await this.craft("iron_chestplate", 1);
    await this.craft("iron_leggings", 1);
    await this.craft("iron_boots", 1);
  }

  _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
}

function _howMany(inventory, itemName, desired) {
  const have = inventory.countOf(itemName);
  return Math.max(0, desired - have);
}

module.exports = CraftingSystem;
