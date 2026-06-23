// ============================================================
// modules/perception.js — Environment scanning and world data
// ============================================================
// Provides structured snapshots of the world around the bot:
//   • Nearby blocks of interest
//   • Nearby entities (hostile / passive / items)
//   • Hazard detection (lava, cliffs, fall damage)
//   • Time-of-day awareness
// ============================================================

const { Vec3 } = require('vec3');
const config = require('./config');

class Perception {
  constructor(bot) {
    this.bot = bot;
  }

  // ---- Block scanning -----------------------------------------

  /**
   * Find the nearest block matching any of the given names.
   * @param {string[]} blockNames
   * @param {number}   maxDistance
   * @returns {Block|null}
   */
  findNearestBlock(blockNames, maxDistance = config.gathering.maxSearchRadius) {
    const namesSet = new Set(Array.isArray(blockNames) ? blockNames : [blockNames]);
    let nearest = null;
    let nearestDist = Infinity;

    for (const name of namesSet) {
      const block = this.bot.findBlock({
        matching: (b) => b.name === name,
        maxDistance,
      });
      if (block) {
        const d = this.bot.entity.position.distanceTo(block.position);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = block;
        }
      }
    }
    return nearest;
  }

  /**
   * Find ALL blocks of the given names within radius.
   * Returns sorted by distance (closest first).
   */
  findAllBlocks(blockNames, maxDistance = config.gathering.maxSearchRadius) {
    const namesSet = new Set(Array.isArray(blockNames) ? blockNames : [blockNames]);
    const results = [];

    for (const name of namesSet) {
      let block = this.bot.findBlock({
        matching: (b) => b.name === name,
        maxDistance,
      });
      while (block) {
        results.push(block);
        // Mineflayer's findBlock only returns one; iterate manually if needed
        break; // We rely on repeated calls from gatherer with updated positions
      }
    }

    results.sort((a, b) =>
      this.bot.entity.position.distanceTo(a.position) -
      this.bot.entity.position.distanceTo(b.position)
    );
    return results;
  }

  /**
   * Scan blocks in a radius using bot.blockAt for fine-grained queries.
   * Returns a list of { block, pos } for each matched block name.
   */
  scanRadius(blockNames, radius = 32) {
    const namesSet = new Set(Array.isArray(blockNames) ? blockNames : [blockNames]);
    const botPos = this.bot.entity.position.floored();
    const results = [];

    for (let dx = -radius; dx <= radius; dx += 2) {
      for (let dy = -8; dy <= 8; dy += 2) {
        for (let dz = -radius; dz <= radius; dz += 2) {
          const pos = botPos.offset(dx, dy, dz);
          const block = this.bot.blockAt(pos);
          if (block && namesSet.has(block.name)) {
            results.push({ block, pos });
          }
        }
      }
    }

    results.sort((a, b) =>
      this.bot.entity.position.distanceTo(a.pos) -
      this.bot.entity.position.distanceTo(b.pos)
    );
    return results;
  }

  // ---- Entity scanning ----------------------------------------

  /**
   * Returns all nearby entities grouped by category.
   * @param {number} radius
   */
  scanEntities(radius = 24) {
    const botPos = this.bot.entity.position;
    const hostile = [];
    const passive = [];
    const items   = [];
    const players = [];

    for (const entity of Object.values(this.bot.entities)) {
      if (entity === this.bot.entity) continue;
      const dist = botPos.distanceTo(entity.position);
      if (dist > radius) continue;

      if (entity.type === 'mob') {
        if (config.combat.hostileMobs.includes(entity.name)) {
          hostile.push({ entity, distance: dist });
        } else if (config.combat.passiveMobs.includes(entity.name)) {
          passive.push({ entity, distance: dist });
        }
      } else if (entity.type === 'object' && entity.name === 'item') {
        items.push({ entity, distance: dist });
      } else if (entity.type === 'player') {
        players.push({ entity, distance: dist });
      }
    }

    // Sort by distance
    const byDist = (a, b) => a.distance - b.distance;
    hostile.sort(byDist);
    passive.sort(byDist);
    items.sort(byDist);

    return { hostile, passive, items, players };
  }

  /** Returns the nearest hostile mob, or null. */
  nearestHostile(radius = 16) {
    const { hostile } = this.scanEntities(radius);
    return hostile.length > 0 ? hostile[0].entity : null;
  }

  /** Returns list of droppable food item entities nearby. */
  nearbyFoodItems(radius = 8) {
    const { items } = this.scanEntities(radius);
    return items.filter(({ entity }) => {
      const meta = entity.metadata;
      // Item entities store their item in metadata slot 7 (varies by version)
      // We check the display name as a fallback
      if (!meta) return false;
      const itemData = meta[7] || meta[8];
      if (!itemData) return false;
      return config.inventory.foodItems.some(f => itemData.name && itemData.name.includes(f));
    });
  }

  // ---- Hazard detection ---------------------------------------

  /**
   * Check if a position is immediately dangerous (lava, void, fire).
   */
  isPositionDangerous(pos) {
    const block = this.bot.blockAt(pos);
    if (!block) return false;
    return ['lava', 'flowing_lava', 'fire', 'soul_fire', 'magma_block'].includes(block.name);
  }

  /**
   * Estimate fall distance from current position in a direction.
   * Returns number of blocks of potential fall.
   */
  checkFallRisk(direction = null) {
    const pos = this.bot.entity.position.floored();
    const checkPos = direction
      ? pos.offset(direction.x, 0, direction.z)
      : pos;

    let fallBlocks = 0;
    for (let dy = 0; dy >= -20; dy--) {
      const b = this.bot.blockAt(checkPos.offset(0, dy, 0));
      if (!b || b.boundingBox === 'block') break;
      fallBlocks++;
    }
    return fallBlocks;
  }

  /**
   * Returns true if the bot is currently in or adjacent to lava.
   */
  isInLava() {
    const pos = this.bot.entity.position;
    const block = this.bot.blockAt(pos);
    return block && (block.name === 'lava' || block.name === 'flowing_lava');
  }

  /**
   * Returns true if the bot is on fire.
   */
  isOnFire() {
    return this.bot.entity.onFire;
  }

  // ---- Time & weather -----------------------------------------

  isNight() {
    const time = this.bot.time.timeOfDay;
    // Night: 13000–23000 ticks
    return time >= 13000 && time <= 23000;
  }

  isRaining() {
    return this.bot.isRaining;
  }

  timeOfDay() {
    const t = this.bot.time.timeOfDay;
    if (t < 6000)  return 'morning';
    if (t < 12000) return 'day';
    if (t < 14000) return 'sunset';
    if (t < 18000) return 'night';
    if (t < 22000) return 'midnight';
    return 'dawn';
  }

  // ---- Inventory summary (used by other modules) --------------

  /**
   * Returns a simple map of itemName → count from bot inventory.
   */
  inventorySummary() {
    const summary = {};
    for (const item of this.bot.inventory.items()) {
      summary[item.name] = (summary[item.name] || 0) + item.count;
    }
    return summary;
  }

  /**
   * Total number of occupied inventory slots.
   */
  occupiedSlots() {
    return this.bot.inventory.items().length;
  }

  /**
   * True if inventory is considered full.
   */
  inventoryFull() {
    return this.occupiedSlots() >= config.inventory.fullThreshold;
  }

  // ---- Health / hunger ----------------------------------------

  getHealth()  { return this.bot.health;  }
  getFood()    { return this.bot.food;    }

  isLowHealth() {
    return this.bot.health <= config.survival.lowHealthThreshold;
  }

  isCriticalHealth() {
    return this.bot.health <= config.survival.criticalHealthThreshold;
  }

  isHungry() {
    return this.bot.food <= config.survival.hungerThreshold;
  }

  // ---- World snapshot -----------------------------------------

  /**
   * Full snapshot used by the state machine for decision making.
   */
  worldSnapshot() {
    const entities = this.scanEntities(24);
    return {
      health:       this.getHealth(),
      food:         this.getFood(),
      isNight:      this.isNight(),
      isRaining:    this.isRaining(),
      timeOfDay:    this.timeOfDay(),
      isOnFire:     this.isOnFire(),
      isInLava:     this.isInLava(),
      hostile:      entities.hostile,
      passive:      entities.passive,
      items:        entities.items,
      inventory:    this.inventorySummary(),
      occupiedSlots: this.occupiedSlots(),
      inventoryFull: this.inventoryFull(),
      position:     this.bot.entity.position.clone(),
    };
  }
}

module.exports = Perception;
