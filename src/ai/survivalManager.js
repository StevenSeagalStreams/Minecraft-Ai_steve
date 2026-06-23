"use strict";

const MODULE = "Survival";

const FOOD_PRIORITY = [
  "golden_apple","cooked_beef","cooked_porkchop","cooked_mutton","cooked_chicken",
  "bread","baked_potato","apple","carrot","potato","porkchop","beef","chicken","mutton",
];

/**
 * Highest-priority subsystem. Monitors and responds to all survival
 * threats: health, hunger, hazards, sleep deprivation.
 *
 * Exposes eat(), sleep(), avoidHazards() for other modules.
 * Should be checked BEFORE tactical decisions every tick.
 */
class SurvivalManager {
  constructor(bot, perception, navigation, inventory, memory, config, logger, eventBus) {
    this.bot        = bot;
    this.perception = perception;
    this.navigation = navigation;
    this.inventory  = inventory;
    this.memory     = memory;
    this.config     = config;
    this.logger     = logger;
    this.eventBus   = eventBus;
  }

  // ─── State queries ────────────────────────────────────────────────────────

  isCritical()     { return this.bot.health <= this.config.health.critical; }
  isLowHealth()    { return this.bot.health <= this.config.health.low; }
  isHungry()       { return this.bot.food < this.config.hunger.low; }
  isStarving()     { return this.bot.food <= this.config.hunger.critical; }
  isNight()        { const t = this.bot.time.timeOfDay; return t >= 13000 && t <= 23000; }

  bestFood() {
    const items = this.inventory.items();
    for (const name of FOOD_PRIORITY) {
      const item = items.find((i) => i.name === name);
      if (item) return item;
    }
    return null;
  }

  // ─── Actions ─────────────────────────────────────────────────────────────

  async eat() {
    const food = this.bestFood();
    if (!food) {
      this.logger.warn(MODULE, "No food available to eat");
      this.eventBus.emit("survival:hungry", { food: this.bot.food });
      return false;
    }
    try {
      await this.bot.equip(food, "hand");
      await this.bot.consume();
      this.logger.debug(MODULE, `Ate ${food.name} (food=${this.bot.food})`);
      return true;
    } catch (err) {
      this.logger.warn(MODULE, `Eat failed: ${err.message}`);
      return false;
    }
  }

  async sleep() {
    const snap = this.perception.last;
    // Find a bed — either in world or in inventory
    let bed = snap?.beds?.[0];
    const remembered = this.memory.getNearestBed(this.bot.entity.position);

    if (!bed && remembered) {
      try {
        await this.navigation.goTo(remembered, { range: 3 });
        bed = this.bot.findBlock({ matching: (b) => b?.name.endsWith("_bed"), maxDistance: 4 });
      } catch (_) {}
    }

    if (!bed) {
      // Place bed if we have one
      if (this.inventory.items().some((i) => i.name.endsWith("_bed"))) {
        bed = await this._placeBed();
      }
    }

    if (!bed) {
      this.logger.warn(MODULE, "No bed found for sleeping");
      return false;
    }

    try {
      await this.navigation.goToBlock(bed, 2);
      await this.bot.sleep(bed);
      this.logger.info(MODULE, "Sleeping through the night");
      await new Promise((r) => this.bot.once("wake", r));
      this.logger.info(MODULE, "Woke up");
      return true;
    } catch (err) {
      this.logger.warn(MODULE, `Sleep failed: ${err.message}`);
      return false;
    }
  }

  async avoidHazards() {
    if (!this.perception.isHazardNearby(3)) return false;
    this.logger.warn(MODULE, "Hazard detected — retreating");
    this.memory.markDanger(this.bot.entity.position, 6, "hazard");
    if (this.memory.hasBase()) {
      await this.navigation.goTo(this.memory.base, { range: 5, timeoutMs: 10000 }).catch(() => null);
    } else {
      await this.navigation.fleeFrom(this.bot.entity.position, 12);
    }
    return true;
  }

  async checkVitals() {
    // Fire damage
    if (this.bot.entity.onFire) {
      this.logger.warn(MODULE, "On fire — looking for water");
      const snap = this.perception.last;
      if (snap?.waterBlocks?.length) {
        const water = snap.waterBlocks[0];
        await this.navigation.goToBlock(water, 1, 5000).catch(() => null);
      }
    }
    // Drowning
    if (this.bot.oxygenLevel !== undefined && this.bot.oxygenLevel < 10) {
      this.logger.warn(MODULE, "Low oxygen — surfacing");
      const pos = this.bot.entity.position;
      await this.navigation.goTo(pos.offset(0, 6, 0), { range: 1, timeoutMs: 5000 }).catch(() => null);
    }
  }

  async _placeBed() {
    const bedItem = this.inventory.items().find((i) => i.name.endsWith("_bed"));
    if (!bedItem) return null;
    const pos     = this.bot.entity.position;
    const refBlock = this.bot.blockAt(pos.offset(1, -1, 0));
    if (!refBlock || refBlock.name === "air") return null;
    try {
      await this.bot.equip(bedItem, "hand");
      await this.bot.placeBlock(refBlock, { x: 0, y: 1, z: 0 });
      const placed = this.bot.findBlock({ matching: (b) => b?.name.endsWith("_bed"), maxDistance: 4 });
      if (placed) this.memory.addBed(placed.position);
      return placed;
    } catch (_) {
      return null;
    }
  }
}

module.exports = SurvivalManager;
