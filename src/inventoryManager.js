// ============================================================
// modules/inventoryManager.js — Inventory tracking & management
// ============================================================
// Responsibilities:
//   • Count items by name
//   • Detect fullness
//   • Equip best available tool for a task
//   • Drop junk items when inventory is critical
//   • Provide item presence checks
// ============================================================

const config = require('./config');

class InventoryManager {
  constructor(bot) {
    this.bot = bot;

    // Tool tier priority (best → worst)
    this.toolTiers = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'];

    console.log('[Inventory] Manager initialised');
  }

  // ---- Item counts --------------------------------------------

  /** Returns total count of an item by name. */
  count(itemName) {
    return this.bot.inventory.items()
      .filter(i => i.name === itemName)
      .reduce((sum, i) => sum + i.count, 0);
  }

  /** True if the bot has at least `n` of an item. */
  has(itemName, n = 1) {
    return this.count(itemName) >= n;
  }

  /** Returns a full map of { itemName: count }. */
  all() {
    const out = {};
    for (const item of this.bot.inventory.items()) {
      out[item.name] = (out[item.name] || 0) + item.count;
    }
    return out;
  }

  /** Number of occupied slots. */
  occupiedSlots() {
    return this.bot.inventory.items().length;
  }

  /** True if inventory should be considered full. */
  isFull() {
    return this.occupiedSlots() >= config.inventory.fullThreshold;
  }

  /** True if critically full (no room to pick up anything). */
  isCriticallyFull() {
    return this.occupiedSlots() >= 36; // hotbar + main inventory
  }

  // ---- Item retrieval -----------------------------------------

  /** Returns the first Item object with this name, or null. */
  getItem(itemName) {
    return this.bot.inventory.items().find(i => i.name === itemName) || null;
  }

  /** Returns all Item objects for a given name. */
  getItems(itemName) {
    return this.bot.inventory.items().filter(i => i.name === itemName);
  }

  // ---- Tool management ----------------------------------------

  /**
   * Equip the best available tool for a given task type.
   * @param {'pickaxe'|'axe'|'shovel'|'hoe'|'sword'} toolType
   */
  async equipBestTool(toolType) {
    for (const tier of this.toolTiers) {
      const name = `${tier}_${toolType}`;
      const item = this.getItem(name);
      if (item) {
        try {
          await this.bot.equip(item, 'hand');
          return name;
        } catch (e) {
          // Item may have disappeared; continue
        }
      }
    }
    return null; // Nothing equipped
  }

  /** Equip any sword available. */
  async equipBestSword() {
    return this.equipBestTool('sword');
  }

  /** Equip the best pickaxe. */
  async equipBestPickaxe() {
    return this.equipBestTool('pickaxe');
  }

  /** Equip best axe. */
  async equipBestAxe() {
    return this.equipBestTool('axe');
  }

  /**
   * Equip the best available armor piece for a given slot (head/torso/legs/feet).
   * Prefers iron over leather. Returns the item name equipped, or null.
   */
  async equipArmorSlot(slot) {
    const slotMap = {
      helmet:     'head',
      chestplate: 'torso',
      leggings:   'legs',
      boots:      'feet',
    };
    const destination = slotMap[slot];
    if (!destination) return null;

    const tiers = ['diamond', 'iron', 'leather'];
    for (const tier of tiers) {
      const name = tier + '_' + slot;
      const item = this.getItem(name);
      if (item) {
        try {
          await this.bot.equip(item, destination);
          return name;
        } catch(e) { /* try next tier */ }
      }
    }
    return null;
  }

  /** Equip whatever armor pieces are currently in inventory but not worn. */
  async equipAllArmor() {
    const equipped = [];
    for (const slot of ['helmet', 'chestplate', 'leggings', 'boots']) {
      const result = await this.equipArmorSlot(slot);
      if (result) equipped.push(result);
    }
    return equipped;
  }

  /** Equip food item in hand. */
  async equipFood() {
    for (const foodName of config.inventory.foodItems) {
      const item = this.getItem(foodName);
      if (item) {
        try {
          await this.bot.equip(item, 'hand');
          return foodName;
        } catch (_) {}
      }
    }
    return null;
  }

  /**
   * Get the best tool type string for a given block.
   * Returns 'pickaxe', 'axe', or 'shovel'.
   */
  bestToolForBlock(block) {
    if (!block) return null;
    const name = block.name || '';
    if (['stone','cobblestone','iron_ore','coal_ore','deepslate'].some(s => name.includes(s))) {
      return 'pickaxe';
    }
    if (['log','planks','wood','leaves'].some(s => name.includes(s))) {
      return 'axe';
    }
    if (['dirt','grass','sand','gravel','soul_sand'].some(s => name.includes(s))) {
      return 'shovel';
    }
    return 'pickaxe'; // default
  }

  /**
   * Equip the best tool for mining a specific block.
   */
  async equipForBlock(block) {
    const toolType = this.bestToolForBlock(block);
    if (toolType) return this.equipBestTool(toolType);
    return null;
  }

  // ---- Food management ----------------------------------------

  /** Returns the best food item in inventory, or null. */
  getBestFood() {
    for (const foodName of config.inventory.foodItems) {
      if (this.has(foodName)) return foodName;
    }
    return null;
  }

  hasFood() {
    return this.getBestFood() !== null;
  }

  // ---- Cleanup ------------------------------------------------

  /**
   * Drop low-value items to free inventory space.
   * Priority of what to drop: cobblestone excess, dirt, gravel,
   *   excess raw wood planks over 64, etc.
   */
  async dropJunk() {
    const junkOrder = [
      { name: 'dirt',          keep: 0  },
      { name: 'gravel',        keep: 0  },
      { name: 'sand',          keep: 0  },
      { name: 'cobblestone',   keep: 32 },
      { name: 'oak_log',       keep: 32 },
      { name: 'birch_log',     keep: 32 },
      { name: 'spruce_log',    keep: 32 },
      { name: 'stone',         keep: 0  },
      { name: 'oak_planks',    keep: 32 },
      { name: 'birch_planks',  keep: 32 },
      { name: 'spruce_planks', keep: 32 },
    ];

    for (const { name, keep } of junkOrder) {
      const total = this.count(name);
      if (total > keep) {
        const toDrop = total - keep;
        const item   = this.getItem(name);
        if (item) {
          try {
            await this.bot.toss(item.type, null, toDrop);
            console.log(`[Inventory] Dropped ${toDrop}x ${name}`);
          } catch (e) {
            console.warn(`[Inventory] Failed to drop ${name}: ${e.message}`);
          }
        }
      }
      if (!this.isFull()) break; // Stop once we have room
    }
  }

  // ---- Planks conversion -------------------------------------

  /**
   * Convert logs to planks if we need planks and have logs.
   * (Done in inventory, no crafting table needed for 4-plank recipe.)
   */
  async convertLogsToPlanks(targetCount = 16) {
    const haveplanks = this.count('oak_planks') + this.count('birch_planks') + this.count('spruce_planks');
    if (haveplanks >= targetCount) return;

    const logTypes = ['oak_log','birch_log','spruce_log','dark_oak_log','jungle_log','acacia_log'];
    for (const log of logTypes) {
      if (this.has(log)) {
        try {
          const recipe = this.bot.recipesFor(
            this.bot.registry.itemsByName[log.replace('_log','_planks')]?.id,
          )[0];
          if (recipe) {
            await this.bot.craft(recipe, 1, null);
          }
        } catch (_) {}
      }
    }
  }

  // ---- Status -------------------------------------------------

  status() {
    return {
      slots: this.occupiedSlots(),
      full: this.isFull(),
      hasFood: this.hasFood(),
      items: this.all(),
    };
  }
}

module.exports = InventoryManager;
