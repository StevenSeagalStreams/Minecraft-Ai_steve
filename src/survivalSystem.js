"use strict";

const FOOD_PRIORITY = [
  "cooked_beef",
  "cooked_porkchop",
  "cooked_mutton",
  "cooked_chicken",
  "bread",
  "baked_potato",
  "apple",
  "carrot",
  "potato",
  "porkchop",
  "beef",
  "chicken",
  "mutton",
];

class SurvivalSystem {
  constructor(bot, perception, navigation, inventory, memory, config) {
    this.bot = bot;
    this.perception = perception;
    this.navigation = navigation;
    this.inventory = inventory;
    this.memory = memory;
    this.config = config;
  }

  isHungry() {
    return this.bot.food < this.config.hungerThreshold;
  }

  isLowHealth() {
    return this.bot.health <= this.config.lowHealthThreshold;
  }

  isCritical() {
    return this.bot.health <= this.config.criticalHealthThreshold;
  }

  getBestFood() {
    const items = this.inventory.getItems();
    for (const name of FOOD_PRIORITY) {
      const food = items.find((i) => i.name === name);
      if (food) return food;
    }
    return null;
  }

  async eatIfHungry() {
    if (!this.isHungry()) return false;
    const food = this.getBestFood();
    if (!food) return false;

    try {
      await this.bot.equip(food, "hand");
      await this.bot.consume();
      return true;
    } catch (err) {
      return false;
    }
  }

  /** Returns true if it's currently dangerous to be outdoors. */
  isNightTime() {
    const t = this.bot.time.timeOfDay;
    return t >= this.config.nightStartTime && t <= this.config.nightEndTime;
  }

  async avoidHazards() {
    const pos = this.bot.entity.position;
    if (this.perception.isHazardNearby(pos, 2)) {
      this.memory.markDanger(pos, 4, "hazard");
      // Step back from the hazard direction by retreating toward the base
      // (or simply staying put if no safe direction is known yet).
      const base = this.memory.baseLocation;
      if (base) {
        await this.navigation.goTo(base, { range: 3, timeoutMs: 10000 }).catch(() => null);
      }
      return true;
    }
    if (this.perception.hasCliffAhead()) {
      this.navigation.stop();
      return true;
    }
    return false;
  }

  /** Handles drowning/suffocation/fall risk by checking air & oxygen. */
  async checkVitals() {
    if (this.bot.oxygenLevel !== undefined && this.bot.oxygenLevel < 5) {
      // Surface to breathe.
      const pos = this.bot.entity.position;
      await this.navigation.goTo(pos.offset(0, 5, 0), { range: 1, timeoutMs: 5000 }).catch(() => null);
    }
  }

  shouldSeekShelter() {
    return this.isNightTime() || this.isCritical();
  }
}

module.exports = SurvivalSystem;
