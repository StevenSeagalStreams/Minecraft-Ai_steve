"use strict";

// Items the bot should always keep on hand and never deposit.
const KEEP_ON_HAND = new Set([
  "wooden_pickaxe",
  "stone_pickaxe",
  "iron_pickaxe",
  "wooden_axe",
  "stone_axe",
  "iron_axe",
  "wooden_sword",
  "stone_sword",
  "iron_sword",
  "bread",
  "cooked_beef",
  "cooked_porkchop",
  "apple",
  "torch",
]);

/**
 * Manages placing/using chests for long-term storage and keeps the
 * bot's working inventory organized.
 */
class StorageSystem {
  constructor(bot, navigation, inventory, memory) {
    this.bot = bot;
    this.navigation = navigation;
    this.inventory = inventory;
    this.memory = memory;
  }

  findNearbyChest(radius = 16) {
    return this.bot.findBlock({
      matching: (b) => b && b.name === "chest",
      maxDistance: radius,
    });
  }

  /** Places a chest near the bot's current position (used during base building). */
  async placeChest() {
    if (!this.inventory.hasItem("chest")) return null;
    const chestItem = this.inventory.getItems().find((i) => i.name === "chest");

    const pos = this.bot.entity.position;
    const refBlock = this.bot.blockAt(pos.offset(1, -1, 0));
    if (!refBlock || refBlock.name === "air") return null;

    try {
      await this.bot.equip(chestItem, "hand");
      await this.bot.placeBlock(refBlock, { x: 0, y: 1, z: 0 });
      const placed = this.bot.blockAt(refBlock.position.offset(0, 1, 0));
      if (placed) this.memory.addChest(placed.position);
      return placed;
    } catch (err) {
      return null;
    }
  }

  /** Deposits everything except items in KEEP_ON_HAND into the nearest chest. */
  async depositExcess() {
    let chest = this.findNearbyChest();
    const remembered = this.memory.getNearestChest(this.bot.entity.position);
    if (!chest && remembered) {
      try {
        await this.navigation.goTo(remembered, { range: 2 });
        chest = this.findNearbyChest(4);
      } catch (_) {
        chest = null;
      }
    }
    if (!chest) return false;

    try {
      await this.navigation.goNearBlock(chest, 2);
      const chestWindow = await this.bot.openContainer(chest);
      const toDeposit = this.inventory
        .getItems()
        .filter((i) => !KEEP_ON_HAND.has(i.name));

      for (const item of toDeposit) {
        try {
          await chestWindow.deposit(item.type, null, item.count);
        } catch (_) {
          // continue with remaining items if one fails (e.g. chest full)
        }
      }
      chestWindow.close();
      this.memory.addChest(chest.position);
      return true;
    } catch (err) {
      return false;
    }
  }

  /** Withdraws a specific item from the nearest chest. */
  async withdraw(itemName, count) {
    const chest = this.findNearbyChest();
    if (!chest) return false;

    try {
      await this.navigation.goNearBlock(chest, 2);
      const chestWindow = await this.bot.openContainer(chest);
      const mcData = require("minecraft-data")(this.bot.version);
      const itemData = mcData.itemsByName[itemName];
      if (!itemData) {
        chestWindow.close();
        return false;
      }
      await chestWindow.withdraw(itemData.id, null, count);
      chestWindow.close();
      return true;
    } catch (err) {
      return false;
    }
  }
}

module.exports = StorageSystem;
