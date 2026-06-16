"use strict";

const HOSTILE_MOBS = new Set([
  "zombie",
  "skeleton",
  "spider",
  "cave_spider",
  "creeper",
  "enderman",
  "witch",
  "drowned",
  "husk",
  "phantom",
  "pillager",
  "slime",
  "magma_cube",
  "blaze",
  "ghast",
  "vindicator",
  "evoker",
  "stray",
]);

const WOOD_BLOCKS = new Set([
  "oak_log",
  "birch_log",
  "spruce_log",
  "jungle_log",
  "acacia_log",
  "dark_oak_log",
  "mangrove_log",
  "cherry_log",
]);

const STONE_BLOCKS = new Set(["stone", "cobblestone", "andesite", "diorite", "granite", "deepslate"]);

const ORE_BLOCKS = {
  iron: new Set(["iron_ore", "deepslate_iron_ore"]),
  coal: new Set(["coal_ore", "deepslate_coal_ore"]),
  gold: new Set(["gold_ore", "deepslate_gold_ore"]),
  diamond: new Set(["diamond_ore", "deepslate_diamond_ore"]),
  redstone: new Set(["redstone_ore", "deepslate_redstone_ore"]),
};

const HAZARD_BLOCKS = new Set(["lava", "flowing_lava", "fire", "magma_block"]);

/**
 * Perception module: scans the world around the bot and returns a
 * structured snapshot that other subsystems can reason about.
 */
class Perception {
  constructor(bot) {
    this.bot = bot;
  }

  /** Full environment scan used by the goal planner / state machine. */
  scan(radius = 16) {
    return {
      position: this.bot.entity.position.clone(),
      health: this.bot.health,
      food: this.bot.food,
      timeOfDay: this.bot.time.timeOfDay,
      isNight: this._isNight(),
      hostileMobs: this.getHostileMobs(radius),
      nearbyItems: this.getNearbyItems(radius),
      woodBlocks: this.findBlocks(WOOD_BLOCKS, radius),
      stoneBlocks: this.findBlocks(STONE_BLOCKS, radius),
      ores: this.findOres(radius),
      hazards: this.findBlocks(HAZARD_BLOCKS, radius),
      players: this.getNearbyPlayers(radius),
    };
  }

  _isNight() {
    const t = this.bot.time.timeOfDay;
    return t >= 13000 && t <= 23000;
  }

  getHostileMobs(radius = 16) {
    return Object.values(this.bot.entities)
      .filter(
        (e) =>
          e.type === "mob" &&
          e.position &&
          HOSTILE_MOBS.has(e.name) &&
          e.position.distanceTo(this.bot.entity.position) <= radius
      )
      .sort(
        (a, b) =>
          a.position.distanceTo(this.bot.entity.position) -
          b.position.distanceTo(this.bot.entity.position)
      );
  }

  getNearbyPlayers(radius = 16) {
    return Object.values(this.bot.entities).filter(
      (e) =>
        e.type === "player" &&
        e.username !== this.bot.username &&
        e.position &&
        e.position.distanceTo(this.bot.entity.position) <= radius
    );
  }

  getNearbyItems(radius = 16) {
    return Object.values(this.bot.entities).filter(
      (e) => e.type === "object" && e.objectType === "Item" && e.position &&
        e.position.distanceTo(this.bot.entity.position) <= radius
    );
  }

  findBlocks(nameSet, radius = 16, maxCount = 32) {
    const matches = this.bot.findBlocks({
      matching: (block) => block && nameSet.has(block.name),
      maxDistance: radius,
      count: maxCount,
    });
    return matches.map((pos) => this.bot.blockAt(pos)).filter(Boolean);
  }

  findOres(radius = 16) {
    const result = {};
    for (const [oreType, nameSet] of Object.entries(ORE_BLOCKS)) {
      result[oreType] = this.findBlocks(nameSet, radius);
    }
    return result;
  }

  /** Returns true if the position is adjacent to a hazardous block. */
  isHazardNearby(position, radius = 2) {
    const blocks = this.findBlocks(HAZARD_BLOCKS, radius);
    return blocks.length > 0;
  }

  /** Checks for a cliff / drop in front of the bot's facing direction. */
  hasCliffAhead(distance = 1) {
    const pos = this.bot.entity.position;
    const yaw = this.bot.entity.yaw;
    const dx = -Math.sin(yaw) * distance;
    const dz = -Math.cos(yaw) * distance;
    const checkPos = pos.offset(dx, 0, dz);
    for (let dy = 0; dy >= -4; dy--) {
      const block = this.bot.blockAt(checkPos.offset(0, dy, 0));
      if (block && block.boundingBox === "block") return false;
    }
    return true;
  }
}

module.exports = {
  Perception,
  HOSTILE_MOBS,
  WOOD_BLOCKS,
  STONE_BLOCKS,
  ORE_BLOCKS,
  HAZARD_BLOCKS,
};
