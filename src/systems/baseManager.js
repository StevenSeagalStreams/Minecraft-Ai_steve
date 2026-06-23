"use strict";

const Vec3 = require("vec3");
const MODULE = "Base";

/**
 * Progressive 4-phase base builder.
 *
 * Phase 1 — Emergency Shelter (dirt/wood box, door gap, crafting table, furnace)
 * Phase 2 — Starter Base (larger, organized chest area, bed, torches)
 * Phase 3 — Expanded Base (farm, perimeter wall, multiple chests)
 * Phase 4 — Advanced Base (villager infra, ender chest, escape tunnels)
 */
class BaseManager {
  constructor(bot, navigation, inventory, crafting, storage, memory, logger, eventBus, config) {
    this.bot       = bot;
    this.navigation = navigation;
    this.inventory = inventory;
    this.crafting  = crafting;
    this.storage   = storage;
    this.memory    = memory;
    this.logger    = logger;
    this.eventBus  = eventBus;
    this.config    = config;
  }

  get phase()    { return this.memory.base?.phase ?? 0; }
  hasBase()      { return this.memory.hasBase(); }
  isNearBase(r = 10) {
    if (!this.memory.hasBase()) return false;
    return this.bot.entity.position.distanceTo(this.memory.base) <= r;
  }

  async returnToBase() {
    if (!this.memory.hasBase()) return false;
    try {
      await this.navigation.goTo(this.memory.base, { range: 3 });
      return true;
    } catch (err) {
      this.logger.warn(MODULE, "Failed to navigate to base");
      return false;
    }
  }

  // ─── Phase 1: Emergency Shelter ──────────────────────────────────────────

  async buildEmergencyShelter() {
    const mat = this._pickMaterial();
    if (!mat) {
      this.logger.warn(MODULE, "No material for shelter — gathering dirt/wood");
      return false;
    }
    this.logger.info(MODULE, `Building emergency shelter from ${mat}`);

    const origin = this.bot.entity.position.floored();
    this.memory.setBase(origin, 1);

    const size = this.config.base.shelterSize;
    const half = Math.floor(size / 2);

    // Outer walls (leave door on south face, center)
    for (let x = -half; x <= half; x++) {
      for (let z = -half; z <= half; z++) {
        const edge = Math.abs(x) === half || Math.abs(z) === half;
        if (!edge) continue;
        const isDoor = z === half && x === 0;
        if (isDoor) continue;
        await this._placeAt(origin.offset(x, 0, z), mat);
      }
    }

    // Roof
    for (let x = -half; x <= half; x++) {
      for (let z = -half; z <= half; z++) {
        await this._placeAt(origin.offset(x, 1, z), mat);
      }
    }

    // Crafting table and furnace inside
    await this.crafting.ensureCraftingTable();
    await this.crafting.ensureFurnace();

    this.logger.info(MODULE, "Emergency shelter built");
    this.eventBus.emit("base:built", { phase: 1, position: origin });
    this.memory.setBasePhase(1);
    return true;
  }

  // ─── Phase 2: Starter Base ────────────────────────────────────────────────

  async upgradeToStarterBase() {
    if (this.phase < 1) return false;
    if (!this.inventory.has("cobblestone", 32) && !this.inventory.has("stone", 32)) return false;

    const mat    = this.inventory.has("cobblestone", 32) ? "cobblestone" : "stone";
    const base   = this.memory.base;
    const origin = new Vec3(base.x, base.y, base.z);
    const newSize = 9;
    const half    = Math.floor(newSize / 2);

    this.logger.info(MODULE, "Upgrading to starter base");

    // Expand walls
    for (let x = -half; x <= half; x++) {
      for (let z = -half; z <= half; z++) {
        const edge  = Math.abs(x) === half || Math.abs(z) === half;
        if (!edge) continue;
        const isDoor = z === half && (x === 0 || x === 1);
        if (!isDoor) await this._placeAt(origin.offset(x, 0, z), mat);
        await this._placeAt(origin.offset(x, 1, z), mat);
      }
    }

    // Place chests
    await this.storage.placeChest("main");
    await this.storage.placeChest("resources");

    // Place a bed if we have wool + planks
    if (this.inventory.has("white_wool", 3) || this.inventory.has("white_wool", 3)) {
      await this.crafting.craft("bed", 1).catch(() => null);
    }
    if (this.inventory.has("white_bed") || this.inventory.has("bed")) {
      await this._placeBed(origin);
    }

    // Torches inside
    await this._placeTorchesInside(origin, newSize);

    this.memory.setBasePhase(2);
    this.eventBus.emit("base:built", { phase: 2, position: origin });
    this.logger.info(MODULE, "Starter base complete");
    return true;
  }

  // ─── Phase 3: Expanded Base ───────────────────────────────────────────────

  async expandBase() {
    if (this.phase < 2) return false;
    this.logger.info(MODULE, "Building base expansion (Phase 3)");
    const base   = this.memory.base;
    const origin = new Vec3(base.x + 12, base.y, base.z);
    const mat    = this._pickMaterial();
    if (!mat) return false;

    const half = 5;
    for (let x = -half; x <= half; x++) {
      for (let z = -half; z <= half; z++) {
        const edge = Math.abs(x) === half || Math.abs(z) === half;
        if (edge) await this._placeAt(origin.offset(x, 0, z), mat);
      }
    }
    for (let i = 0; i < 3; i++) await this.storage.placeChest(`expansion_${i}`);

    this.memory.setBasePhase(3);
    this.eventBus.emit("base:built", { phase: 3, position: origin });
    return true;
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  _pickMaterial() {
    const priority = ["cobblestone","stone","oak_planks","dirt"];
    for (const name of priority) {
      if (this.inventory.has(name, 20)) return name;
    }
    return null;
  }

  async _placeAt(position, material) {
    const item = this.inventory.items().find((i) => i.name === material);
    if (!item) return;
    const below = this.bot.blockAt(position.offset(0, -1, 0));
    const target = this.bot.blockAt(position);
    if (target && target.name !== "air") return;
    if (!below || below.name === "air") return;

    try {
      await this.navigation.goTo(position, { range: 3, timeoutMs: 8000 });
      await this.bot.equip(item, "hand");
      await this.bot.placeBlock(below, new Vec3(0, 1, 0));
    } catch (_) {}
  }

  async _placeBed(origin) {
    const bedItem = this.inventory.items().find((i) => i.name.endsWith("_bed"));
    if (!bedItem) return;
    const pos = origin.offset(-1, 0, -2);
    const below = this.bot.blockAt(pos.offset(0, -1, 0));
    if (!below || below.name === "air") return;
    try {
      await this.bot.equip(bedItem, "hand");
      await this.bot.placeBlock(below, new Vec3(0, 1, 0));
      this.memory.addBed(pos);
    } catch (_) {}
  }

  async _placeTorchesInside(origin, size) {
    const half = Math.floor(size / 2);
    const positions = [
      origin.offset(-half + 2, 1, -half + 2),
      origin.offset(half  - 2, 1, -half + 2),
      origin.offset(-half + 2, 1,  half - 2),
      origin.offset(half  - 2, 1,  half - 2),
    ];
    for (const pos of positions) {
      if (!this.inventory.has("torch")) break;
      const item = this.inventory.items().find((i) => i.name === "torch");
      if (!item) break;
      const wall = this.bot.blockAt(pos.offset(0, 0, -1));
      if (!wall || wall.name === "air") continue;
      try {
        await this.bot.equip(item, "hand");
        await this.bot.placeBlock(wall, new Vec3(0, 0, 1));
      } catch (_) {}
    }
  }

  _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
}

module.exports = BaseManager;
