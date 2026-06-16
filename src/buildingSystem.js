"use strict";

const Vec3 = require("vec3");

/**
 * Builds a simple 5x5 walled shelter with a roof and a door gap, and can
 * expand it (extra walls / storage room) over time once the basics exist.
 */
class BuildingSystem {
  constructor(bot, navigation, inventory, memory) {
    this.bot = bot;
    this.navigation = navigation;
    this.inventory = inventory;
    this.memory = memory;
    this.size = 5; // outer wall length
    this.wallMaterial = null; // resolved at build time based on inventory
  }

  _pickWallMaterial() {
    const candidates = ["cobblestone", "stone", "oak_planks", "dirt"];
    for (const name of candidates) {
      if (this.inventory.hasItem(name, 20)) return name;
    }
    return null;
  }

  hasEnoughMaterials() {
    return this._pickWallMaterial() !== null;
  }

  async _placeBlockAt(position, item) {
    const below = this.bot.blockAt(position.offset(0, -1, 0));
    const target = this.bot.blockAt(position);
    if (target && target.name !== "air") return false; // already occupied
    if (!below) return false;

    try {
      await this.bot.equip(item, "hand");
      await this.bot.placeBlock(below, new Vec3(0, 1, 0));
      return true;
    } catch (err) {
      return false;
    }
  }

  /** Builds a basic 5x5 shelter centered on the bot's current position. */
  async buildShelter() {
    this.wallMaterial = this._pickWallMaterial();
    if (!this.wallMaterial) return false;

    const origin = this.bot.entity.position.floored();
    this.memory.setBase(origin);

    const half = Math.floor(this.size / 2);
    let placedAny = false;

    // Walls (1 block high, leaving a 1-block door gap on the south side).
    for (let x = -half; x <= half; x++) {
      for (let z = -half; z <= half; z++) {
        const isEdge = Math.abs(x) === half || Math.abs(z) === half;
        if (!isEdge) continue;

        const isDoorGap = z === half && x === 0;
        if (isDoorGap) continue;

        const wallPos = origin.offset(x, 0, z);
        const item = this.inventory.getItems().find((i) => i.name === this.wallMaterial);
        if (!item) continue;

        try {
          await this.navigation.goTo(wallPos, { range: 3, timeoutMs: 10000 });
        } catch (_) {
          continue;
        }
        const ok = await this._placeBlockAt(wallPos, item);
        placedAny = placedAny || ok;
      }
    }

    // Roof.
    for (let x = -half; x <= half; x++) {
      for (let z = -half; z <= half; z++) {
        const roofPos = origin.offset(x, 1, z);
        const item = this.inventory.getItems().find((i) => i.name === this.wallMaterial);
        if (!item) continue;
        try {
          await this.navigation.goTo(roofPos.offset(0, -1, 0), { range: 3, timeoutMs: 10000 });
        } catch (_) {
          continue;
        }
        await this._placeBlockAt(roofPos, item);
      }
    }

    return placedAny;
  }

  /** Adds an extra storage/expansion room adjacent to the existing base. */
  async expandBase() {
    if (!this.memory.hasBase()) return false;
    this.wallMaterial = this._pickWallMaterial();
    if (!this.wallMaterial) return false;

    const base = this.memory.baseLocation;
    const expansionOrigin = new Vec3(base.x + this.size, base.y, base.z);
    const half = Math.floor(this.size / 2);
    let placedAny = false;

    for (let x = -half; x <= half; x++) {
      for (let z = -half; z <= half; z++) {
        const isEdge = Math.abs(x) === half || Math.abs(z) === half;
        if (!isEdge) continue;
        const wallPos = expansionOrigin.offset(x, 0, z);
        const item = this.inventory.getItems().find((i) => i.name === this.wallMaterial);
        if (!item) continue;
        try {
          await this.navigation.goTo(wallPos, { range: 3, timeoutMs: 10000 });
        } catch (_) {
          continue;
        }
        const ok = await this._placeBlockAt(wallPos, item);
        placedAny = placedAny || ok;
      }
    }

    return placedAny;
  }

  isNearBase(radius = 8) {
    if (!this.memory.hasBase()) return false;
    const base = this.memory.baseLocation;
    return this.bot.entity.position.distanceTo(base) <= radius;
  }
}

module.exports = BuildingSystem;
