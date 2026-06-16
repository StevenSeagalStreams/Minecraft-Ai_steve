"use strict";

/**
 * Persistent-in-memory knowledge store shared across all subsystems.
 * Keeps track of the base location, known resource clusters and danger
 * zones so the bot can make smarter decisions over time.
 */
class MemorySystem {
  constructor() {
    this.baseLocation = null; // { x, y, z }
    this.resourceLocations = {
      wood: [],
      stone: [],
      iron: [],
      coal: [],
      food: [],
    };
    this.dangerZones = []; // { x, y, z, radius, reason, timestamp }
    this.chestLocations = [];
    this.lastKnownGoal = null;
    this.stats = {
      blocksMined: 0,
      mobsKilled: 0,
      deaths: 0,
      itemsCrafted: 0,
    };
  }

  setBase(position) {
    this.baseLocation = { x: position.x, y: position.y, z: position.z };
  }

  hasBase() {
    return this.baseLocation !== null;
  }

  remember(type, position) {
    if (!this.resourceLocations[type]) this.resourceLocations[type] = [];
    const exists = this.resourceLocations[type].some(
      (p) => p.x === position.x && p.y === position.y && p.z === position.z
    );
    if (!exists) {
      this.resourceLocations[type].push({
        x: position.x,
        y: position.y,
        z: position.z,
        discoveredAt: Date.now(),
      });
    }
  }

  getNearestResource(type, position) {
    const list = this.resourceLocations[type] || [];
    if (list.length === 0) return null;
    let nearest = null;
    let nearestDist = Infinity;
    for (const loc of list) {
      const dist =
        (loc.x - position.x) ** 2 +
        (loc.y - position.y) ** 2 +
        (loc.z - position.z) ** 2;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = loc;
      }
    }
    return nearest;
  }

  markDanger(position, radius, reason) {
    this.dangerZones.push({
      x: position.x,
      y: position.y,
      z: position.z,
      radius,
      reason,
      timestamp: Date.now(),
    });
    // Cap memory growth
    if (this.dangerZones.length > 200) this.dangerZones.shift();
  }

  isDangerous(position) {
    return this.dangerZones.some((zone) => {
      const dist = Math.sqrt(
        (zone.x - position.x) ** 2 +
          (zone.y - position.y) ** 2 +
          (zone.z - position.z) ** 2
      );
      return dist <= zone.radius;
    });
  }

  addChest(position) {
    const exists = this.chestLocations.some(
      (p) => p.x === position.x && p.y === position.y && p.z === position.z
    );
    if (!exists) {
      this.chestLocations.push({ x: position.x, y: position.y, z: position.z });
    }
  }

  getNearestChest(position) {
    if (this.chestLocations.length === 0) return null;
    let nearest = null;
    let nearestDist = Infinity;
    for (const loc of this.chestLocations) {
      const dist =
        (loc.x - position.x) ** 2 +
        (loc.y - position.y) ** 2 +
        (loc.z - position.z) ** 2;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = loc;
      }
    }
    return nearest;
  }

  incrementStat(key, amount = 1) {
    if (this.stats[key] === undefined) this.stats[key] = 0;
    this.stats[key] += amount;
  }
}

module.exports = MemorySystem;
