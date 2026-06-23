"use strict";

const MODULE = "Storage";

// Items never deposited into chests — always kept in bot inventory.
const KEEP_PERSONAL = new Set([
  "wooden_pickaxe","stone_pickaxe","iron_pickaxe","diamond_pickaxe","netherite_pickaxe",
  "wooden_axe","stone_axe","iron_axe","diamond_axe","netherite_axe",
  "wooden_sword","stone_sword","iron_sword","diamond_sword","netherite_sword",
  "iron_helmet","iron_chestplate","iron_leggings","iron_boots",
  "diamond_helmet","diamond_chestplate","diamond_leggings","diamond_boots",
  "cooked_beef","cooked_porkchop","bread","golden_apple","cooked_chicken",
  "torch","crafting_table","chest","furnace","shield","totem_of_undying",
  "coal",  // keep some fuel
]);

class StorageSystem {
  constructor(bot, navigation, inventory, memory, crafting, logger, eventBus) {
    this.bot       = bot;
    this.navigation = navigation;
    this.inventory = inventory;
    this.memory    = memory;
    this.crafting  = crafting;
    this.logger    = logger;
    this.eventBus  = eventBus;
  }

  // ─── Chest placement ──────────────────────────────────────────────────────

  async placeChest(label = "general") {
    if (!this.inventory.has("chest")) {
      // Auto-craft one
      if (!this.inventory.has("oak_planks", 8) && !this.inventory.has("oak_log", 1)) return null;
      await this.crafting.craft("chest", 1);
    }
    if (!this.inventory.has("chest")) return null;

    const item = this.inventory.items().find((i) => i.name === "chest");
    const refBlock = this.bot.blockAt(this.bot.entity.position.offset(2, -1, 0));
    if (!refBlock || refBlock.name === "air") return null;

    try {
      await this.bot.equip(item, "hand");
      await this.bot.placeBlock(refBlock, { x: 0, y: 1, z: 0 });
      await this._sleep(400);
      const placed = this.bot.blockAt(refBlock.position.offset(0, 1, 0));
      if (placed && placed.name === "chest") {
        this.memory.addChest(placed.position, label);
        this.logger.info(MODULE, `Placed chest "${label}" at ${_fmt(placed.position)}`);
        return placed;
      }
    } catch (err) {
      this.logger.warn(MODULE, `Failed to place chest: ${err.message}`);
    }
    return null;
  }

  // ─── Deposit ─────────────────────────────────────────────────────────────

  async depositExcess() {
    const chest = await this._findOrNavigateToChest();
    if (!chest) {
      this.logger.warn(MODULE, "No chest available for deposit");
      return false;
    }

    try {
      const win = await this.bot.openContainer(chest);
      const toDeposit = this.inventory.items().filter((i) => !KEEP_PERSONAL.has(i.name));
      let deposited = 0;

      for (const item of toDeposit) {
        try {
          await win.deposit(item.type, null, item.count);
          deposited += item.count;
        } catch (_) {
          // Chest might be full
          break;
        }
      }

      win.close();
      this.logger.info(MODULE, `Deposited ${deposited} items into chest`);
      this.eventBus.emit("storage:deposited", { count: deposited });
      return true;
    } catch (err) {
      this.logger.error(MODULE, `Deposit failed: ${err.message}`);
      return false;
    }
  }

  // ─── Withdraw ─────────────────────────────────────────────────────────────

  async withdraw(itemName, count) {
    const chest = await this._findOrNavigateToChest();
    if (!chest) return false;

    try {
      const win     = await this.bot.openContainer(chest);
      const mcData  = require("minecraft-data")(this.bot.version);
      const itemData = mcData.itemsByName[itemName];
      if (!itemData) { win.close(); return false; }

      await win.withdraw(itemData.id, null, count);
      win.close();
      this.logger.info(MODULE, `Withdrew ${count}x ${itemName}`);
      return true;
    } catch (err) {
      this.logger.warn(MODULE, `Withdraw failed: ${err.message}`);
      return false;
    }
  }

  // ─── Helper ───────────────────────────────────────────────────────────────

  async _findOrNavigateToChest() {
    // Try world scan first
    const nearby = this.bot.findBlock({ matching: (b) => b?.name === "chest", maxDistance: 12 });
    if (nearby) {
      await this.navigation.goToBlock(nearby, 2).catch(() => null);
      return nearby;
    }

    // Navigate to remembered chest
    const rem = this.memory.getNearestChest(this.bot.entity.position);
    if (rem) {
      try {
        await this.navigation.goTo(rem, { range: 3 });
        const block = this.bot.findBlock({ matching: (b) => b?.name === "chest", maxDistance: 4 });
        return block;
      } catch (_) {}
    }
    return null;
  }

  _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
}

function _fmt(p) { return `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`; }

module.exports = StorageSystem;
