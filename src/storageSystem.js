// ============================================================
// modules/storageSystem.js — Chest management and item storage
// ============================================================
// Handles:
//   • Creating and locating chests near base
//   • Depositing non-essential items
//   • Withdrawing needed items
//   • Chest directory (tracked in memory)
// ============================================================

const { Vec3 } = require('vec3');
const config   = require('./config');

class StorageSystem {
  constructor(bot, inventory, navigation, memory) {
    this.bot        = bot;
    this.inventory  = inventory;
    this.navigation = navigation;
    this.memory     = memory;
    this.knownContents = {}; // itemName -> count, our best estimate of chest contents

    console.log('[Storage] System initialised');
  }

  // ---- Deposit ------------------------------------------------

  /**
   * Deposit all non-essential items into the nearest chest.
   * If no chest exists, try to place one.
   */
  async depositItems() {
    const chestBlock = await this._ensureChest();
    if (!chestBlock) {
      console.warn('[Storage] No chest available for deposit');
      return false;
    }

    console.log('[Storage] Depositing items into chest...');
    await this.navigation.moveToBlock(chestBlock.position);

    let chest;
    try {
      chest = await this.bot.openChest(chestBlock);
      await this._sleep(400);
    } catch (e) {
      console.warn('[Storage] Could not open chest:', e.message);
      return false;
    }

    const keepSet = new Set(config.inventory.keepItems);
    let depositedAny = false;

    // Raw materials we want to keep a working buffer of, rather than
    // depositing 100% of — the bot still needs logs/cobblestone on hand
    // for crafting and building while it works.
    const materialBuffers = {
      oak_log: 8, birch_log: 8, spruce_log: 8, dark_oak_log: 8,
      jungle_log: 8, acacia_log: 8,
      oak_planks: 16, birch_planks: 16, spruce_planks: 16,
      dark_oak_planks: 16, jungle_planks: 16, acacia_planks: 16,
      cobblestone: 8,
    };

    for (const item of this.bot.inventory.items()) {
      if (keepSet.has(item.name)) continue;

      // Keep minimum food
      if (config.inventory.foodItems.includes(item.name)) {
        const keep = 8;
        if (item.count <= keep) continue;
        const toDeposit = item.count - keep;
        try {
          await chest.deposit(item.type, null, toDeposit);
          this._trackDeposit(item.name, toDeposit);
          depositedAny = true;
          await this._sleep(100);
        } catch (_) {}
        continue;
      }

      // Keep a working buffer of raw materials, deposit only the excess
      if (materialBuffers[item.name] !== undefined) {
        const keep = materialBuffers[item.name];
        if (item.count <= keep) continue;
        const toDeposit = item.count - keep;
        try {
          await chest.deposit(item.type, null, toDeposit);
          this._trackDeposit(item.name, toDeposit);
          depositedAny = true;
          await this._sleep(100);
        } catch (_) {}
        continue;
      }

      // Deposit everything else
      try {
        await chest.deposit(item.type, null, item.count);
        this._trackDeposit(item.name, item.count);
        depositedAny = true;
        await this._sleep(100);
      } catch (_) {}
    }

    chest.close();
    if (depositedAny) {
      console.log('[Storage] Deposit complete. Known stash: ' + this.summary());
    } else {
      console.log('[Storage] Nothing new to deposit');
    }
    return true;
  }

  _trackDeposit(name, count) {
    this.knownContents[name] = (this.knownContents[name] || 0) + count;
  }

  _trackWithdraw(name, count) {
    if (!this.knownContents[name]) return;
    this.knownContents[name] = Math.max(0, this.knownContents[name] - count);
  }

  /** How many of an item are believed to be stored (not counting inventory). */
  stashCount(name) {
    return this.knownContents[name] || 0;
  }

  /** Compact human-readable summary, e.g. "cobblestone:64 oak_log:12" */
  summary() {
    const entries = Object.entries(this.knownContents).filter(([,c]) => c > 0);
    if (!entries.length) return 'empty';
    return entries.map(([n,c]) => n + ':' + c).join(' ');
  }

  // ---- Withdraw -----------------------------------------------

  /**
   * Withdraw `count` of `itemName` from any known chest.
   */
  async withdraw(itemName, count = 1) {
    const chestEntry = this.memory.getNearestChest(this.bot.entity.position);
    if (!chestEntry) return false;

    const pos = new Vec3(chestEntry.pos.x, chestEntry.pos.y, chestEntry.pos.z);
    const block = this.bot.blockAt(pos);
    if (!block || !block.name.includes('chest')) return false;

    await this.navigation.moveTo(pos, 2);

    let chest;
    try {
      chest = await this.bot.openChest(block);
      await this._sleep(400);
    } catch (e) {
      return false;
    }

    const id = this.bot.registry.itemsByName[itemName]?.id;
    if (!id) { chest.close(); return false; }

    const inChest = chest.items().find(i => i.type === id);
    if (!inChest) { chest.close(); return false; }

    try {
      const toWithdraw = Math.min(count, inChest.count);
      await chest.withdraw(id, null, toWithdraw);
      this._trackWithdraw(itemName, toWithdraw);
      await this._sleep(200);
    } catch (e) {
      chest.close();
      return false;
    }

    chest.close();
    return true;
  }

  // ---- Chest creation -----------------------------------------

  async _ensureChest() {
    // Check if a chest is already nearby
    const nearby = this.bot.findBlock({
      matching: (b) => b.name === 'chest',
      maxDistance: 6,
    });
    if (nearby) return nearby;

    // Check memory for closest chest
    const remembered = this.memory.getNearestChest(this.bot.entity.position);
    if (remembered) {
      const pos = new Vec3(remembered.pos.x, remembered.pos.y, remembered.pos.z);
      const dist = this.bot.entity.position.distanceTo(pos);
      if (dist < 32) {
        await this.navigation.moveTo(pos, 2);
        const block = this.bot.blockAt(pos);
        if (block?.name === 'chest') return block;
      }
    }

    // Craft a chest if we don't have one
    if (!this.inventory.has('chest')) {
      const crafted = await this._craftChest();
      if (!crafted) return null;
    }

    return this._placeChest();
  }

  async _craftChest() {
    // Need 8 planks
    const plankTypes = ['oak_planks','birch_planks','spruce_planks'];
    const totalPlanks = plankTypes.reduce((s, p) => s + this.inventory.count(p), 0);

    if (totalPlanks < 8) {
      console.warn('[Storage] Not enough planks to craft chest');
      return false;
    }

    const id = this.bot.registry.itemsByName['chest']?.id;
    if (!id) return false;

    // Find a crafting table
    const table = this.bot.findBlock({
      matching: this.bot.registry.blocksByName['crafting_table'].id,
      maxDistance: 8,
    });

    const recipes = this.bot.recipesFor(id, null, 1, table);
    if (!recipes.length) return false;

    try {
      await this.bot.craft(recipes[0], 1, table);
      return true;
    } catch (e) {
      console.warn('[Storage] Failed to craft chest:', e.message);
      return false;
    }
  }

  /**
   * Places a chest right next to the nearest crafting table — used for
   * the early-game chest so it ends up at the bot's actual home base
   * rather than wherever the bot happens to be standing.
   */
  async placeChestNearTable() {
    const tableId = this.bot.registry.blocksByName['crafting_table']?.id;
    const table = tableId ? this.bot.findBlock({ matching: tableId, maxDistance: 16 }) : null;
    if (table) {
      try { await this.navigation.moveTo(table.position, 3); } catch(e) {}
    }
    const result = await this._placeChest();
    return !!result;
  }

  async _placeChest() {
    const item = this.inventory.getItem('chest');
    if (!item) return null;

    // Try to place near base, otherwise near current position
    const base   = this.memory.getBase() || this.bot.entity.position;
    const origin = this.bot.entity.position;

    const candidates = [];
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        candidates.push(origin.offset(dx, 0, dz));
      }
    }

    for (const target of candidates) {
      const ground = this.bot.blockAt(target.offset(0, -1, 0));
      const at     = this.bot.blockAt(target);
      if (!ground || ground.boundingBox !== 'block') continue;
      if (!at || at.name !== 'air') continue;

      // Don't place in a blacklisted or dangerous spot
      if (this.memory.isDangerous(target)) continue;

      try {
        await this.bot.equip(item, 'hand');
        await this.navigation.moveTo(target.offset(1, 0, 0), 1);
        await this.bot.placeBlock(ground, new Vec3(0, 1, 0));
        const placed = this.bot.blockAt(target);
        if (placed?.name === 'chest') {
          this.memory.addChest(target, 'general');
          console.log(`[Storage] Placed chest at ${target}`);
          return placed;
        }
      } catch (e) {
        // Try next candidate
      }
    }

    console.warn('[Storage] Could not place chest');
    return null;
  }

  // ---- Utility ------------------------------------------------

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

module.exports = StorageSystem;
