"use strict";

const MODULE = "Farming";
const Vec3   = require("vec3");

const CROP_DATA = {
  wheat:     { seed: "wheat_seeds",      farmBlock: "farmland", growStage: 7 },
  carrots:   { seed: "carrot",           farmBlock: "farmland", growStage: 7 },
  potatoes:  { seed: "potato",           farmBlock: "farmland", growStage: 7 },
  beetroots: { seed: "beetroot_seeds",   farmBlock: "farmland", growStage: 3 },
  pumpkins:  { seed: "pumpkin_seeds",    farmBlock: "farmland", growStage: 7 },
  melons:    { seed: "melon_seeds",      farmBlock: "farmland", growStage: 7 },
};

/**
 * Simple 5×5 row farm builder and harvester.
 * - Digs a water-irrigation trench in the center
 * - Tills soil with a hoe
 * - Plants available seeds
 * - Detects fully grown crops and harvests them
 */
class FarmingSystem {
  constructor(bot, navigation, inventory, crafting, memory, logger) {
    this.bot        = bot;
    this.navigation = navigation;
    this.inventory  = inventory;
    this.crafting   = crafting;
    this.memory     = memory;
    this.logger     = logger;
  }

  // ─── Build a farm ─────────────────────────────────────────────────────────

  async buildFarm(cropType = "wheat") {
    if (!CROP_DATA[cropType]) { this.logger.warn(MODULE, `Unknown crop: ${cropType}`); return false; }

    const pos    = this.bot.entity.position.floored();
    const origin = pos.offset(3, 0, 0);
    const size   = 5;
    this.logger.info(MODULE, `Building ${cropType} farm at ${_fmt(origin)}`);

    // Ensure we have a hoe
    if (!this.inventory.getBestTool("hoe")) {
      await this.crafting.craft("wooden_hoe", 1);
    }

    // Till soil and plant seeds
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        if (z === 2) continue; // irrigation row
        const farmPos = origin.offset(x, 0, z);
        await this._till(farmPos);
        await this._plant(farmPos, cropType);
      }
    }

    // Dig water channel
    const waterPos = origin.offset(0, 0, 2);
    const waterItem = this.inventory.items().find((i) => i.name === "water_bucket");
    if (waterItem) {
      const below = this.bot.blockAt(waterPos.offset(0, -1, 0));
      if (below) {
        try {
          await this.navigation.goTo(waterPos, { range: 3 });
          await this.bot.equip(waterItem, "hand");
          await this.bot.activateBlock(below);
        } catch (_) {}
      }
    }

    this.memory.addFarm(origin, cropType, size);
    this.logger.info(MODULE, `Farm built for ${cropType}`);
    return true;
  }

  // ─── Harvest ──────────────────────────────────────────────────────────────

  async harvestFarm() {
    let harvested = 0;
    for (const [cropType, data] of Object.entries(CROP_DATA)) {
      const fullGrown = this.bot.findBlocks({
        matching: (b) => b && b.name === cropType && b.metadata === data.growStage,
        maxDistance: 32,
        count: 64,
      });
      for (const pos of fullGrown) {
        const block = this.bot.blockAt(pos);
        if (!block) continue;
        try {
          await this.navigation.goToBlock(block, 2);
          await this.bot.dig(block);
          harvested++;
          // Replant
          await this._plant(pos, cropType);
        } catch (_) {}
      }
    }
    this.logger.info(MODULE, `Harvested ${harvested} crops`);
    return harvested;
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  async _till(position) {
    const hoe = this.inventory.getBestTool("hoe");
    if (!hoe) return;
    const block = this.bot.blockAt(position);
    if (!block || block.name === "farmland") return;
    try {
      await this.navigation.goTo(position, { range: 3 });
      await this.bot.equip(hoe, "hand");
      await this.bot.activateBlock(block);
    } catch (_) {}
  }

  async _plant(position, cropType) {
    const data = CROP_DATA[cropType];
    if (!data) return;
    const seedItem = this.inventory.items().find((i) => i.name === data.seed);
    if (!seedItem) return;
    const farmlandBlock = this.bot.blockAt(position);
    if (!farmlandBlock || farmlandBlock.name !== "farmland") return;
    try {
      await this.bot.equip(seedItem, "hand");
      await this.bot.activateBlock(farmlandBlock);
    } catch (_) {}
  }
}

function _fmt(p) { return `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`; }

module.exports = FarmingSystem;
