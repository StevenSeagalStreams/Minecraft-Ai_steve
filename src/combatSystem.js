"use strict";

class CombatSystem {
  constructor(bot, perception, navigation, inventory, memory, config) {
    this.bot = bot;
    this.perception = perception;
    this.navigation = navigation;
    this.inventory = inventory;
    this.memory = memory;
    this.config = config;
  }

  /** Picks the most dangerous/closest hostile mob to deal with first. */
  selectTarget(mobs) {
    if (!mobs || mobs.length === 0) return null;
    const THREAT_WEIGHT = { creeper: 3, skeleton: 2, enderman: 2 };
    return mobs
      .slice()
      .sort((a, b) => {
        const wa = THREAT_WEIGHT[a.name] || 1;
        const wb = THREAT_WEIGHT[b.name] || 1;
        const da = a.position.distanceTo(this.bot.entity.position);
        const db = b.position.distanceTo(this.bot.entity.position);
        return da / wa - db / wb;
      })[0];
  }

  shouldFlee() {
    return this.bot.health <= this.config.fleeHealthThreshold;
  }

  async fight(target) {
    if (!target || !target.isValid) return false;

    if (this.shouldFlee()) {
      await this.flee(target.position);
      return false;
    }

    await this.inventory.equipBestTool("sword").catch(() => null);

    const maxAttempts = 40;
    for (let i = 0; i < maxAttempts; i++) {
      if (!target.isValid) return true; // target died or despawned
      if (this.shouldFlee()) {
        await this.flee(target.position);
        return false;
      }

      const dist = target.position.distanceTo(this.bot.entity.position);
      if (dist > this.config.combatEngageRange) return false; // target fled too far

      if (dist > 3) {
        try {
          await this.navigation.goNearBlock({ position: target.position }, 2, 5000);
        } catch (_) {
          // keep trying to close distance
        }
      } else {
        this.bot.lookAt(target.position.offset(0, target.height ?? 1, 0));
        try {
          this.bot.attack(target);
        } catch (_) {
          // entity may have just despawned
        }
        await this._sleep(600); // respect attack cooldown
      }
    }
    this.memory.incrementStat("mobsKilled");
    return true;
  }

  async flee(threatPosition) {
    this.memory.markDanger(threatPosition, 16, "hostile_mob");
    await this.navigation.fleeFrom(threatPosition, 16);
  }

  async handleHostiles(hostileMobs) {
    const target = this.selectTarget(hostileMobs);
    if (!target) return false;

    const dist = target.position.distanceTo(this.bot.entity.position);
    if (this.bot.health <= this.config.lowHealthThreshold && dist > 4) {
      await this.flee(target.position);
      return false;
    }

    return this.fight(target);
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = CombatSystem;
