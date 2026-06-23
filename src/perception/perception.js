"use strict";

const { HOSTILE_MOB_DATA, classifyThreat } = require("./mobClassifier");

const WOOD_BLOCKS  = new Set(["oak_log","birch_log","spruce_log","jungle_log","acacia_log","dark_oak_log","mangrove_log","cherry_log"]);
const STONE_BLOCKS = new Set(["stone","cobblestone","andesite","diorite","granite","deepslate","tuff"]);
const ORE_BLOCKS   = {
  coal:     new Set(["coal_ore","deepslate_coal_ore"]),
  iron:     new Set(["iron_ore","deepslate_iron_ore"]),
  gold:     new Set(["gold_ore","deepslate_gold_ore","nether_gold_ore"]),
  diamond:  new Set(["diamond_ore","deepslate_diamond_ore"]),
  redstone: new Set(["redstone_ore","deepslate_redstone_ore"]),
  lapis:    new Set(["lapis_ore","deepslate_lapis_ore"]),
  emerald:  new Set(["emerald_ore","deepslate_emerald_ore"]),
  netherite: new Set(["ancient_debris"]),
};
const HAZARD_BLOCKS = new Set(["lava","flowing_lava","fire","magma_block","soul_fire","wither_rose"]);
const WATER_BLOCKS  = new Set(["water","flowing_water"]);
const FOOD_MOBS     = new Set(["cow","pig","sheep","chicken","rabbit","salmon","cod","tropical_fish"]);

/**
 * Single source of truth for world state snapshots.
 * Other modules MUST read from the last snapshot rather than
 * querying the world independently, to keep CPU usage bounded.
 */
class Perception {
  constructor(bot, logger) {
    this.bot     = bot;
    this.logger  = logger;
    this.last    = null;   // most recent snapshot
    this._scanRadius = 32;
  }

  /**
   * Full world scan. Call this on a timer, not on every tick.
   * Returns a rich snapshot used by all AI modules.
   */
  scan(radius = this._scanRadius) {
    const pos    = this.bot.entity.position.clone();
    const health = this.bot.health;
    const food   = this.bot.food;
    const time   = this.bot.time.timeOfDay;

    const hostileMobs = this._getHostileMobs(radius);
    const passiveMobs = this._getPassiveMobs(radius);
    const players     = this._getNearbyPlayers(radius);
    const droppedItems= this._getDroppedItems(radius);

    const snap = {
      position:     pos,
      health,
      food,
      saturation:   this.bot.foodSaturation ?? 0,
      timeOfDay:    time,
      isNight:      time >= 13000 && time <= 23000,
      isDawn:       time >= 23000 || time < 1000,
      raining:      this.bot.isRaining ?? false,
      dimension:    this.bot.game?.dimension ?? "overworld",

      // Entities
      hostileMobs,
      passiveMobs,
      players,
      droppedItems,
      nearestThreat: hostileMobs[0] ?? null,

      // Blocks
      woodBlocks:  this._findBlocks(WOOD_BLOCKS,  radius, 16),
      stoneBlocks: this._findBlocks(STONE_BLOCKS, radius, 16),
      ores:        this._findOres(radius),
      hazards:     this._findBlocks(HAZARD_BLOCKS, 8, 8),
      waterBlocks: this._findBlocks(WATER_BLOCKS,  8, 8),
      chests:      this._findNamedBlocks("chest", radius, 8),
      beds:        this._findBeds(radius),
      craftingTables: this._findNamedBlocks("crafting_table", radius, 4),
      furnaces:    this._findNamedBlocks("furnace", radius, 4),

      // Derived danger signals
      immediateDanger: hostileMobs.length > 0 && hostileMobs[0].position.distanceTo(pos) < 8,
      inWater:     this.bot.entity.isInWater ?? false,
      onFire:      this.bot.entity.onFire    ?? false,
      fallHeight:  this._estimateFallHeight(pos),
    };

    this.last = snap;
    return snap;
  }

  // ─── Entity queries ───────────────────────────────────────────────────────

  _getHostileMobs(radius) {
    return Object.values(this.bot.entities)
      .filter((e) =>
        e.type === "mob" &&
        e.isValid !== false &&
        HOSTILE_MOB_DATA[e.name] &&
        e.position?.distanceTo(this.bot.entity.position) <= radius
      )
      .map((e) => ({
        entity:      e,
        name:        e.name,
        position:    e.position,
        distance:    e.position.distanceTo(this.bot.entity.position),
        health:      e.health ?? HOSTILE_MOB_DATA[e.name]?.maxHealth ?? 20,
        threatScore: classifyThreat(e, this.bot),
      }))
      .sort((a, b) => b.threatScore - a.threatScore);
  }

  _getPassiveMobs(radius) {
    return Object.values(this.bot.entities)
      .filter((e) =>
        e.type === "mob" &&
        FOOD_MOBS.has(e.name) &&
        e.position?.distanceTo(this.bot.entity.position) <= radius
      )
      .map((e) => ({
        entity: e,
        name:   e.name,
        position: e.position,
        distance: e.position.distanceTo(this.bot.entity.position),
      }));
  }

  _getNearbyPlayers(radius) {
    return Object.values(this.bot.entities).filter(
      (e) => e.type === "player" &&
        e.username !== this.bot.username &&
        e.position?.distanceTo(this.bot.entity.position) <= radius
    );
  }

  _getDroppedItems(radius) {
    return Object.values(this.bot.entities).filter(
      (e) => e.type === "object" &&
        e.objectType === "Item" &&
        e.position?.distanceTo(this.bot.entity.position) <= radius
    ).sort((a,b) =>
      a.position.distanceTo(this.bot.entity.position) -
      b.position.distanceTo(this.bot.entity.position)
    );
  }

  // ─── Block queries ────────────────────────────────────────────────────────

  _findBlocks(nameSet, radius, maxCount = 32) {
    const positions = this.bot.findBlocks({
      matching: (b) => b && nameSet.has(b.name),
      maxDistance: radius,
      count: maxCount,
    });
    return positions.map((p) => this.bot.blockAt(p)).filter(Boolean);
  }

  _findNamedBlocks(name, radius, maxCount = 8) {
    const positions = this.bot.findBlocks({
      matching: (b) => b && b.name === name,
      maxDistance: radius,
      count: maxCount,
    });
    return positions.map((p) => this.bot.blockAt(p)).filter(Boolean);
  }

  _findOres(radius) {
    const result = {};
    for (const [oreType, nameSet] of Object.entries(ORE_BLOCKS)) {
      result[oreType] = this._findBlocks(nameSet, radius, 8);
    }
    return result;
  }

  _findBeds(radius) {
    const bedNames = new Set([
      "white_bed","orange_bed","magenta_bed","light_blue_bed","yellow_bed",
      "lime_bed","pink_bed","gray_bed","light_gray_bed","cyan_bed",
      "purple_bed","blue_bed","brown_bed","green_bed","red_bed","black_bed",
    ]);
    return this._findBlocks(bedNames, radius, 4);
  }

  _estimateFallHeight(pos) {
    let h = 0;
    for (let dy = 1; dy <= 20; dy++) {
      const block = this.bot.blockAt(pos.offset(0, -dy, 0));
      if (block && block.boundingBox === "block") break;
      h = dy;
    }
    return h;
  }

  // ─── Convenience accessors ────────────────────────────────────────────────

  isHazardNearby(range = 3) {
    const snap = this.last;
    return snap && snap.hazards.some((b) => b.position.distanceTo(this.bot.entity.position) <= range);
  }

  hasCliffAhead() {
    const pos = this.bot.entity.position;
    const yaw = this.bot.entity.yaw;
    for (let r = 1; r <= 2; r++) {
      const cx = pos.x - Math.sin(yaw) * r;
      const cz = pos.z - Math.cos(yaw) * r;
      let solid = false;
      for (let dy = -1; dy >= -4; dy--) {
        const b = this.bot.blockAt({ x: Math.round(cx), y: Math.round(pos.y + dy), z: Math.round(cz) });
        if (b && b.boundingBox === "block") { solid = true; break; }
      }
      if (!solid) return true;
    }
    return false;
  }
}

module.exports = { Perception, WOOD_BLOCKS, STONE_BLOCKS, ORE_BLOCKS, HAZARD_BLOCKS, FOOD_MOBS };
