"use strict";

const MODULE = "DeathRecovery";

const DESPAWN_MS = 300 * 1000; // 5 minutes

/**
 * Death recovery system:
 *  1. Records cause, position, and lost items
 *  2. Estimates retrieval probability based on time elapsed, distance, and known threats
 *  3. If probability is acceptable: gears up minimally and rushes to recover items
 *  4. If not acceptable: rebuilds from stored resources
 */
class DeathRecovery {
  constructor(bot, perception, navigation, inventory, crafting, storage, memory, logger, config, eventBus) {
    this.bot        = bot;
    this.perception = perception;
    this.navigation = navigation;
    this.inventory  = inventory;
    this.crafting   = crafting;
    this.storage    = storage;
    this.memory     = memory;
    this.logger     = logger;
    this.config     = config;
    this.eventBus   = eventBus;
    this._deathTime = null;

    // Listen for death events from mineflayer
    bot.on("death", () => this._onDeath());
  }

  _onDeath() {
    const pos   = this.bot.entity?.position ?? { x: 0, y: 64, z: 0 };
    const items = this.inventory.summarize();
    this._deathTime = Date.now();

    this.memory.recordDeath(pos, "unknown", items);
    this.memory.markDanger(pos, 16, "death_site");
    this.logger.warn(MODULE, `Died at ${_fmt(pos)}. Items: ${JSON.stringify(items)}`);
    this.eventBus.emit("death:occurred", { position: pos, items });
  }

  /**
   * Main recovery routine. Call this after re-spawning and waiting for
   * the bot to be fully operational again.
   */
  async recover() {
    const deathRecord = this.memory.getLastDeath();
    if (!deathRecord) {
      this.logger.info(MODULE, "No pending death recovery");
      return false;
    }

    const ageMs        = Date.now() - deathRecord.timestamp;
    const timeLeft     = DESPAWN_MS - ageMs;
    const deathPos     = deathRecord;
    const prob         = this._estimateRetrievalProb(deathPos, timeLeft);

    this.logger.info(MODULE, `Recovery probability: ${(prob * 100).toFixed(0)}% (${Math.round(timeLeft/1000)}s left)`);

    if (timeLeft <= 0 || prob < this.config.recovery.minRetrieveChance) {
      this.logger.warn(MODULE, "Items likely despawned or recovery too dangerous — rebuilding");
      await this._rebuild();
      this.memory.markLastDeathRecovered();
      return false;
    }

    return await this._attemptRetrieval(deathPos, timeLeft);
  }

  _estimateRetrievalProb(deathPos, timeLeftMs) {
    if (timeLeftMs <= 0) return 0;

    const pos     = this.bot.entity.position;
    const dist    = Math.sqrt((deathPos.x - pos.x)**2 + (deathPos.z - pos.z)**2);
    const timeFrac = Math.max(0, timeLeftMs / DESPAWN_MS);

    // Distance penalty: >200 blocks = 0 probability
    const distFrac = Math.max(0, 1 - dist / 200);

    // Danger penalty from remembered danger zones
    const dangerPenalty = this.memory.isDangerous(deathPos) ? 0.4 : 0;

    return Math.max(0, timeFrac * distFrac - dangerPenalty);
  }

  async _attemptRetrieval(deathPos, timeLeftMs) {
    this.logger.info(MODULE, `Attempting item retrieval at ${_fmt(deathPos)}`);

    // Get minimal gear first
    if (this.config.recovery.gearUpBeforeReturn) {
      await this._getMinimalGear();
    }

    // Rush to death site
    const timeoutMs = Math.min(timeLeftMs * 0.8, 60000);
    try {
      await this.navigation.goTo(deathPos, { range: 2, timeoutMs });
    } catch (err) {
      this.logger.warn(MODULE, `Navigation to death site failed: ${err.message}`);
      return false;
    }

    // Collect dropped items (bot auto-picks them up on proximity)
    await this._sleep(2000);
    const collected = this.inventory.items().length > 0;
    this.memory.markLastDeathRecovered();
    this.logger.info(MODULE, `Recovery complete. Items collected: ${JSON.stringify(this.inventory.summarize())}`);
    this.eventBus.emit("death:recovered", { itemsRecovered: this.inventory.summarize() });
    return collected;
  }

  async _getMinimalGear() {
    // Retrieve from chest if available, else craft from scratch
    const hasPickaxe = this.inventory.getBestTool("pickaxe") !== null;
    const hasSword   = this.inventory.getBestTool("sword")   !== null;
    const hasFood    = this.inventory.has("cooked_beef") || this.inventory.has("bread");

    if (!hasPickaxe || !hasSword || !hasFood) {
      await this.storage.withdraw("stone_pickaxe", 1).catch(() => null);
      await this.storage.withdraw("stone_sword",   1).catch(() => null);
      await this.storage.withdraw("bread",         4).catch(() => null);
    }

    // Last resort: craft wooden tools
    if (!this.inventory.getBestTool("pickaxe")) {
      await this.crafting.craftWoodenTools().catch(() => null);
    }
  }

  async _rebuild() {
    this.logger.info(MODULE, "Rebuilding from stored resources");
    await this.storage.withdraw("iron_pickaxe",   1).catch(() => null);
    await this.storage.withdraw("iron_sword",     1).catch(() => null);
    await this.storage.withdraw("iron_chestplate",1).catch(() => null);
    await this.storage.withdraw("cooked_beef",    16).catch(() => null);

    // If nothing in storage, start from scratch
    const hasTool = this.inventory.getBestTool("pickaxe");
    if (!hasTool) {
      await this.crafting.craftWoodenTools().catch(() => null);
    }
  }

  _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
}

function _fmt(p) { return `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`; }

module.exports = DeathRecovery;
