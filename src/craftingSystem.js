// ============================================================
// modules/craftingSystem.js — Automated crafting subsystem
// ============================================================
// Handles:
//   • 2×2 (inventory) crafting for planks, sticks, crafting table
//   • 3×3 (table) crafting for all tools
//   • Furnace smelting (iron, food)
//   • Dynamic recipe lookup via mineflayer registry
//   • Placing / finding crafting tables and furnaces
// ============================================================

const { Vec3 } = require('vec3');
const config   = require('./config');

class CraftingSystem {
  constructor(bot, inventory, navigation, memory) {
    this.bot        = bot;
    this.inventory  = inventory;
    this.navigation = navigation;
    this.memory     = memory;

    console.log('[Crafting] System initialised');
  }

  // ---- Item ID helper ----------------------------------------

  _itemId(name) {
    return this.bot.registry.itemsByName[name]?.id ?? null;
  }

  // ---- Generic craft ------------------------------------------

  /**
   * Craft `count` of `itemName`, using a crafting table if needed.
   * Returns true on success.
   */
  async craft(itemName, count = 1) {
    const id = this._itemId(itemName);
    if (id === null) {
      console.warn(`[Crafting] Unknown item: ${itemName}`);
      return false;
    }

    // Try inventory (2×2) crafting first
    const invRecipes = this.bot.recipesFor(id, null, 1, null);
    if (invRecipes.length > 0) {
      try {
        await this.bot.craft(invRecipes[0], count, null);
        console.log(`[Crafting] Crafted ${count}x ${itemName} (inventory)`);
        return true;
      } catch (e) {
        // May need crafting table
      }
    }

    // Try crafting table
    const table = await this._ensureCraftingTable();
    if (!table) return false;

    const tableRecipes = this.bot.recipesFor(id, null, 1, table);
    if (tableRecipes.length === 0) {
      console.warn(`[Crafting] No recipe found for ${itemName}`);
      return false;
    }

    try {
      await this.bot.craft(tableRecipes[0], count, table);
      console.log(`[Crafting] Crafted ${count}x ${itemName} (table)`);
      return true;
    } catch (e) {
      console.warn(`[Crafting] Failed to craft ${itemName}: ${e.message}`);
      return false;
    }
  }

  // ---- Crafting table management ------------------------------

  /**
   * Ensures a crafting table is nearby and returns the block.
   * Places one from inventory if none found in memory/world.
   */
  async _ensureCraftingTable() {
    // Check if one is nearby already
    let table = this.bot.findBlock({
      matching: this.bot.registry.blocksByName['crafting_table'].id,
      maxDistance: 4,
    });
    if (table) return table;

    // Check memory for a known table
    const remembered = this.memory.getNearestCraftingTable(this.bot.entity.position);
    if (remembered) {
      const pos = new Vec3(remembered.pos.x, remembered.pos.y, remembered.pos.z);
      const arrived = await this.navigation.moveTo(pos, 3);
      if (arrived) {
        table = this.bot.blockAt(pos);
        if (table?.name === 'crafting_table') return table;
      }
    }

    // Craft a crafting table if we have planks / logs
    if (!this.inventory.has('crafting_table')) {
      const crafted = await this._craftCraftingTable();
      if (!crafted) return null;
    }

    // Place the crafting table
    return this._placeCraftingTable();
  }

  async _craftCraftingTable() {
    // Make sure we have planks
    await this._ensurePlanks(4);

    const id = this._itemId('crafting_table');
    if (!id) return false;
    const recipes = this.bot.recipesFor(id, null, 1, null);
    if (!recipes.length) return false;
    try {
      await this.bot.craft(recipes[0], 1, null);
      return true;
    } catch (e) {
      return false;
    }
  }

  async _placeCraftingTable() {
    const item = this.inventory.getItem('crafting_table');
    if (!item) return null;

    // Find a solid block in front of the bot to place against
    const pos  = this.bot.entity.position.floored();
    const candidates = [
      pos.offset(1, 0, 0), pos.offset(-1, 0, 0),
      pos.offset(0, 0, 1), pos.offset(0, 0, -1),
    ];

    for (const target of candidates) {
      const ground = this.bot.blockAt(target.offset(0, -1, 0));
      const above  = this.bot.blockAt(target);
      if (!ground || ground.boundingBox !== 'block') continue;
      if (above && above.name !== 'air') continue;

      try {
        await this.bot.equip(item, 'hand');
        await this.bot.placeBlock(ground, new Vec3(0, 1, 0));
        const placed = this.bot.blockAt(target);
        if (placed?.name === 'crafting_table') {
          this.memory.addCraftingTable(target);
          console.log(`[Crafting] Placed crafting table at ${target}`);
          return placed;
        }
      } catch (e) {
        console.warn('[Crafting] Failed to place crafting table:', e.message);
      }
    }
    return null;
  }

  // ---- Furnace management -------------------------------------

  async _ensureFurnace() {
    let furnace = this.bot.findBlock({
      matching: this.bot.registry.blocksByName['furnace'].id,
      maxDistance: 4,
    });
    if (furnace) return furnace;

    // Check memory
    const remembered = this.memory.getNearestFurnace(this.bot.entity.position);
    if (remembered) {
      const pos = new Vec3(remembered.pos.x, remembered.pos.y, remembered.pos.z);
      await this.navigation.moveTo(pos, 3);
      furnace = this.bot.blockAt(pos);
      if (furnace?.name === 'furnace') return furnace;
    }

    // Craft + place
    if (!this.inventory.has('furnace')) {
      await this.craft('furnace');
    }
    return this._placeFurnace();
  }

  async _placeFurnace() {
    const item = this.inventory.getItem('furnace');
    if (!item) return null;

    const pos = this.bot.entity.position.floored();
    const candidates = [
      pos.offset(2, 0, 0), pos.offset(-2, 0, 0),
      pos.offset(0, 0, 2), pos.offset(0, 0, -2),
    ];

    for (const target of candidates) {
      const ground = this.bot.blockAt(target.offset(0, -1, 0));
      const above  = this.bot.blockAt(target);
      if (!ground || ground.boundingBox !== 'block') continue;
      if (above && above.name !== 'air') continue;

      try {
        await this.bot.equip(item, 'hand');
        await this.bot.placeBlock(ground, new Vec3(0, 1, 0));
        const placed = this.bot.blockAt(target);
        if (placed?.name === 'furnace') {
          this.memory.addFurnace(target);
          console.log(`[Crafting] Placed furnace at ${target}`);
          return placed;
        }
      } catch (e) {
        console.warn('[Crafting] Failed to place furnace:', e.message);
      }
    }
    return null;
  }

  // ---- Smelting -----------------------------------------------

  /**
   * Smelt `inputItem` into `outputItem` using coal as fuel.
   * @param {string} inputItem   e.g. 'raw_iron'
   * @param {string} outputItem  e.g. 'iron_ingot'
   * @param {number} count
   */
  async smelt(inputItem, outputItem, count = 1) {
    if (!this.inventory.has(inputItem, count)) {
      console.warn(`[Crafting] Not enough ${inputItem} to smelt`);
      return false;
    }

    const furnaceBlock = await this._ensureFurnace();
    if (!furnaceBlock) {
      console.warn('[Crafting] No furnace available');
      return false;
    }

    // Move to furnace
    await this.navigation.moveToBlock(furnaceBlock.position);

    try {
      const furnace = await this.bot.openFurnace(furnaceBlock);
      await this._sleep(500);

      // Check if we have fuel
      const coalCount = this.inventory.count('coal') + this.inventory.count('charcoal');
      const fuelNeeded = Math.ceil(count / 8); // ~8 items per coal
      if (coalCount < fuelNeeded) {
        // Use planks as fuel if no coal
        const planks = this.inventory.getItem('oak_planks') ||
                       this.inventory.getItem('birch_planks') ||
                       this.inventory.getItem('spruce_planks');
        if (planks) {
          await furnace.putFuel(planks.type, null, Math.min(planks.count, fuelNeeded * 8));
        }
      } else {
        const coal = this.inventory.getItem('coal') || this.inventory.getItem('charcoal');
        if (coal) {
          await furnace.putFuel(coal.type, null, Math.min(coal.count, fuelNeeded));
        }
      }

      // Put input
      const inputItem_ = this.inventory.getItem(inputItem);
      if (inputItem_) {
        await furnace.putInput(inputItem_.type, null, count);
      }

      // Wait for smelting (roughly 10 seconds per item)
      console.log(`[Crafting] Smelting ${count}x ${inputItem}...`);
      await this._sleep(count * 10000 + 2000);

      // Take output
      if (furnace.outputItem()) {
        await furnace.takeOutput();
      }

      furnace.close();
      console.log(`[Crafting] Smelted ${count}x ${inputItem} → ${outputItem}`);
      return true;
    } catch (e) {
      console.warn(`[Crafting] Smelting failed: ${e.message}`);
      return false;
    }
  }

  // ---- High-level crafting goals ------------------------------

  async craftWoodenTools() {
    await this._ensurePlanks(7);
    await this._ensureSticks(4);
    await this.craft('wooden_pickaxe');
    await this.craft('wooden_axe');
    await this.craft('wooden_sword');
  }

  async craftStoneTools() {
    const cobble = this.inventory.count('cobblestone');
    if (cobble < 11) {
      console.log('[Crafting] Not enough cobblestone for stone tools');
      return false;
    }
    await this._ensureSticks(4);
    await this.craft('stone_pickaxe');
    await this.craft('stone_axe');
    await this.craft('stone_sword');
    return true;
  }

  async craftIronTools() {
    // Need 11 iron ingots
    const ingots = this.inventory.count('iron_ingot');
    if (ingots < 11) {
      // Try smelting raw iron
      const rawIron = this.inventory.count('raw_iron');
      if (rawIron > 0) {
        await this.smelt('raw_iron', 'iron_ingot', Math.min(rawIron, 11 - ingots));
      }
    }
    if (this.inventory.count('iron_ingot') < 11) return false;

    await this._ensureSticks(4);
    await this.craft('iron_pickaxe');
    await this.craft('iron_axe');
    await this.craft('iron_sword');
    return true;
  }

  async craftTorches(count = 8) {
    const coal = this.inventory.count('coal') + this.inventory.count('charcoal');
    const sticks = this.inventory.count('stick');
    const possible = Math.min(coal, sticks, Math.floor(count / 4));
    if (possible === 0) return;
    await this.craft('torch', possible);
  }

  // ---- Material helpers ---------------------------------------

  async _ensurePlanks(count) {
    const plankTypes = ['oak_planks','birch_planks','spruce_planks','dark_oak_planks'];
    const have = plankTypes.reduce((s, p) => s + this.inventory.count(p), 0);
    if (have >= count) return;

    const logTypes = ['oak_log','birch_log','spruce_log','dark_oak_log'];
    for (const log of logTypes) {
      if (this.inventory.has(log)) {
        const plankName = log.replace('_log', '_planks');
        const id = this._itemId(plankName);
        if (!id) continue;
        const recipes = this.bot.recipesFor(id, null, 1, null);
        if (recipes.length) {
          try { await this.bot.craft(recipes[0], 1, null); } catch (_) {}
        }
        return;
      }
    }
  }

  async _ensureSticks(count) {
    if (this.inventory.count('stick') >= count) return;
    await this._ensurePlanks(2);
    await this.craft('stick', Math.ceil(count / 4));
  }

  // ---- Utility ------------------------------------------------

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

module.exports = CraftingSystem;
