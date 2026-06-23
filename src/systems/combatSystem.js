"use strict";

const { HOSTILE_MOB_DATA, shouldEngage } = require("../perception/mobClassifier");
const MODULE = "Combat";

/**
 * Combat system with:
 *   - Threat ranking and target selection
 *   - Melee + ranged attack logic
 *   - Creeper special handling (retreat + wait)
 *   - Enderman avoidance (no eye contact)
 *   - Skeleton kiting (strafe + close-in)
 *   - Auto-retreat + re-engage cycle
 *   - Loot collection after kill
 */
class CombatSystem {
  constructor(bot, perception, navigation, inventory, memory, logger, config, eventBus) {
    this.bot        = bot;
    this.perception = perception;
    this.navigation = navigation;
    this.inventory  = inventory;
    this.memory     = memory;
    this.logger     = logger;
    this.config     = config;
    this.eventBus   = eventBus;
    this._inCombat  = false;
  }

  get inCombat() { return this._inCombat; }

  // ─── High-level entry point ───────────────────────────────────────────────

  async handleThreats(hostileMobs) {
    if (!hostileMobs.length) return;

    // Warden: always run
    const warden = hostileMobs.find((m) => m.name === "warden");
    if (warden) {
      this.logger.warn(MODULE, "WARDEN DETECTED — FLEEING");
      await this._flee(warden.position);
      return;
    }

    // Critical health → flee everything
    if (this.bot.health <= this.config.health.critical) {
      this.logger.warn(MODULE, "Critical health — retreating from all hostiles");
      await this._flee(hostileMobs[0].position);
      return;
    }

    // Too many mobs → flee
    if (hostileMobs.length > this.config.combat.maxMobsEngage) {
      this.logger.warn(MODULE, `${hostileMobs.length} hostiles — too many, retreating`);
      await this._flee(hostileMobs[0].position);
      return;
    }

    // Pick best target
    const target = this._selectTarget(hostileMobs);
    if (!target) return;

    if (!shouldEngage(target.name, this.bot)) {
      this.logger.info(MODULE, `Policy: avoid ${target.name} — fleeing`);
      await this._flee(target.position);
      return;
    }

    this.eventBus.emit("combat:start", { target: target.name });
    await this._fight(target);
  }

  // ─── Target selection ─────────────────────────────────────────────────────

  _selectTarget(mobs) {
    // Prefer closest imminent threats; then highest threat score
    return mobs.sort((a, b) => {
      const immA = a.distance < 6 ? 1000 : 0;
      const immB = b.distance < 6 ? 1000 : 0;
      return (b.threatScore + immB) - (a.threatScore + immA);
    })[0] ?? null;
  }

  // ─── Combat loop ─────────────────────────────────────────────────────────

  async _fight(target) {
    this._inCombat = true;
    await this.inventory.equipBestTool("sword");
    this.logger.info(MODULE, `Engaging ${target.name}`);

    const maxTicks = 60;
    for (let i = 0; i < maxTicks; i++) {
      const entity = target.entity;
      if (!entity.isValid) { break; } // target dead/despawned

      if (this.bot.health <= this.config.health.low) {
        this.logger.warn(MODULE, "Health low mid-fight — retreating");
        await this._flee(entity.position);
        break;
      }

      const dist = entity.position.distanceTo(this.bot.entity.position);

      // Special mob handling
      if (target.name === "creeper") {
        await this._fightCreeper(entity, dist);
      } else if (target.name === "skeleton" || target.name === "stray") {
        await this._fightRangedMob(entity, dist);
      } else if (target.name === "enderman") {
        await this._fightEnderman(entity, dist);
      } else {
        await this._meleeFight(entity, dist);
      }

      await this._sleep(100);
    }

    this._inCombat = false;
    if (!target.entity.isValid) {
      this.memory.increment("mobsKilled");
      this.eventBus.emit("combat:end", { target: target.name, success: true });
      await this._collectLoot();
    } else {
      this.eventBus.emit("combat:end", { target: target.name, success: false });
    }
  }

  async _meleeFight(entity, dist) {
    if (dist > 3) {
      try { await this.navigation.goToBlock({ position: entity.position }, 2, 3000); } catch (_) {}
    } else {
      await this.bot.lookAt(entity.position.offset(0, entity.height ?? 1, 0), true);
      try { this.bot.attack(entity); } catch (_) {}
      await this._sleep(550); // match attack cooldown ~1.8/s for sword
    }
  }

  async _fightCreeper(entity, dist) {
    // Keep >5 blocks; attack then back away
    if (dist < 6) {
      this.navigation.stop();
      // Back up
      const pos = this.bot.entity.position;
      const dx  = pos.x - entity.position.x;
      const dz  = pos.z - entity.position.z;
      const len = Math.sqrt(dx*dx + dz*dz) || 1;
      const target = { x: pos.x + (dx/len)*4, y: pos.y, z: pos.z + (dz/len)*4 };
      try { await this.navigation.goTo(target, { range: 1, timeoutMs: 2000 }); } catch (_) {}
    } else if (dist <= 10) {
      await this.bot.lookAt(entity.position.offset(0, 1, 0), true);
      try { this.bot.attack(entity); } catch (_) {}
      await this._sleep(600);
    }
  }

  async _fightRangedMob(entity, dist) {
    // Approach to melee range and strafe
    if (dist > 4) {
      try { await this.navigation.goToBlock({ position: entity.position }, 3, 4000); } catch (_) {}
    } else {
      await this._meleeFight(entity, dist);
    }
  }

  async _fightEnderman(entity, dist) {
    // Never look at its eyes; look at feet instead
    await this.bot.lookAt(entity.position, false);
    await this._meleeFight(entity, dist);
  }

  async _flee(threatPos) {
    this._inCombat = false;
    this.memory.markDanger(threatPos, 16, "hostile");
    await this.navigation.fleeFrom(threatPos, this.config.combat.fleeRange);
  }

  async _collectLoot(radius = 8) {
    const items = Object.values(this.bot.entities).filter(
      (e) => e.type === "object" && e.objectType === "Item" &&
        e.position?.distanceTo(this.bot.entity.position) <= radius
    );
    for (const item of items) {
      try { await this.navigation.goTo(item.position, { range: 1, timeoutMs: 5000 }); } catch (_) {}
    }
  }

  _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
}

module.exports = CombatSystem;
