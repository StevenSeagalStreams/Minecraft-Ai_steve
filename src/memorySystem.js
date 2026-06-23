// ============================================================
// modules/memorySystem.js — Persistent spatial memory for the bot
// ============================================================
// Stores: base location, resource deposits, danger zones,
// known chest positions, and explored chunk sets.
// Data is kept in-process; extend with JSON serialization for
// persistence across restarts.
// ============================================================

const { Vec3 } = require('vec3');

class MemorySystem {
  constructor(bot) {
    this.bot = bot;

    // --- Core memory stores ---
    this.baseLocation = null;         // Vec3 — home position
    this.bedLocation  = null;         // Vec3 — bed if placed

    // Keyed by string "x,y,z" for O(1) lookup
    this.resourceDeposits = new Map(); // pos → { type, lastSeen, richness }
    this.dangerZones      = new Map(); // pos → { reason, timestamp }
    this.chestLocations   = new Map(); // pos → { category, lastAudit }
    this.craftingTables   = new Map(); // pos → { lastUsed }
    this.furnaces         = new Map(); // pos → { lastUsed }

    // Exploration tracking — rough 16-block grid cells
    this.exploredCells = new Set();

    // Short-term path blacklist — positions that caused the bot to get stuck
    this.blacklistedPositions = new Map(); // pos → timestamp

    console.log('[Memory] System initialised');
  }

  // ---- Utility ------------------------------------------------

  _key(pos) {
    return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
  }

  _cellKey(pos) {
    // Coarsen to 16-block cells
    return `${Math.floor(pos.x / 16)},${Math.floor(pos.z / 16)}`;
  }

  _now() {
    return Date.now();
  }

  // ---- Base location ------------------------------------------

  setBase(pos) {
    this.baseLocation = pos.clone ? pos.clone() : new Vec3(pos.x, pos.y, pos.z);
    console.log(`[Memory] Base location recorded: ${this._key(this.baseLocation)}`);
  }

  getBase() {
    return this.baseLocation;
  }

  // ---- Resource deposits --------------------------------------

  /**
   * Record that a resource type was found at pos.
   * @param {Vec3}   pos
   * @param {string} type  — block name e.g. 'oak_log'
   */
  addResourceDeposit(pos, type) {
    const key = this._key(pos);
    this.resourceDeposits.set(key, {
      type,
      pos: { x: pos.x, y: pos.y, z: pos.z },
      lastSeen: this._now(),
    });
  }

  /**
   * Returns the nearest known deposit of a given type,
   * or null if none are remembered.
   */
  getNearestDeposit(type, fromPos) {
    let best = null;
    let bestDist = Infinity;

    for (const [, entry] of this.resourceDeposits) {
      if (entry.type !== type) continue;
      const p = entry.pos;
      const d = fromPos.distanceTo(new Vec3(p.x, p.y, p.z));
      if (d < bestDist) {
        bestDist = d;
        best = entry;
      }
    }
    return best;
  }

  /** Remove a deposit (e.g. after it has been fully mined). */
  removeDeposit(pos) {
    this.resourceDeposits.delete(this._key(pos));
  }

  getAllDeposits(type) {
    const results = [];
    for (const [, entry] of this.resourceDeposits) {
      if (!type || entry.type === type) results.push(entry);
    }
    return results;
  }

  // ---- Danger zones -------------------------------------------

  addDangerZone(pos, reason = 'unknown') {
    this.dangerZones.set(this._key(pos), {
      pos: { x: pos.x, y: pos.y, z: pos.z },
      reason,
      timestamp: this._now(),
    });
    console.log(`[Memory] Danger zone noted at ${this._key(pos)}: ${reason}`);
  }

  isDangerous(pos, radius = 8) {
    for (const [, zone] of this.dangerZones) {
      const zp = new Vec3(zone.pos.x, zone.pos.y, zone.pos.z);
      if (pos.distanceTo(zp) <= radius) return true;
    }
    return false;
  }

  // ---- Chests -------------------------------------------------

  addChest(pos, category = 'general') {
    this.chestLocations.set(this._key(pos), {
      pos: { x: pos.x, y: pos.y, z: pos.z },
      category,
      lastAudit: this._now(),
    });
  }

  getChests(category = null) {
    const results = [];
    for (const [, chest] of this.chestLocations) {
      if (!category || chest.category === category) results.push(chest);
    }
    return results;
  }

  getNearestChest(fromPos, category = null) {
    const chests = this.getChests(category);
    if (!chests.length) return null;
    return chests.reduce((best, c) => {
      const cp = new Vec3(c.pos.x, c.pos.y, c.pos.z);
      const bd = best ? fromPos.distanceTo(new Vec3(best.pos.x, best.pos.y, best.pos.z)) : Infinity;
      return fromPos.distanceTo(cp) < bd ? c : best;
    }, null);
  }

  // ---- Crafting tables / Furnaces -----------------------------

  addCraftingTable(pos) {
    this.craftingTables.set(this._key(pos), { pos: { x: pos.x, y: pos.y, z: pos.z }, lastUsed: null });
  }

  getNearestCraftingTable(fromPos) {
    return this._nearest(this.craftingTables, fromPos);
  }

  addFurnace(pos) {
    this.furnaces.set(this._key(pos), { pos: { x: pos.x, y: pos.y, z: pos.z }, lastUsed: null });
  }

  getNearestFurnace(fromPos) {
    return this._nearest(this.furnaces, fromPos);
  }

  _nearest(map, fromPos) {
    let best = null;
    let bestDist = Infinity;
    for (const [, entry] of map) {
      const ep = new Vec3(entry.pos.x, entry.pos.y, entry.pos.z);
      const d = fromPos.distanceTo(ep);
      if (d < bestDist) { bestDist = d; best = entry; }
    }
    return best;
  }

  // ---- Exploration --------------------------------------------

  markExplored(pos) {
    this.exploredCells.add(this._cellKey(pos));
  }

  isExplored(pos) {
    return this.exploredCells.has(this._cellKey(pos));
  }

  // ---- Stuck blacklist ----------------------------------------

  blacklistPosition(pos) {
    this.blacklistedPositions.set(this._key(pos), this._now());
  }

  isBlacklisted(pos) {
    const ts = this.blacklistedPositions.get(this._key(pos));
    if (!ts) return false;
    // Blacklist expires after 5 minutes
    return (this._now() - ts) < 5 * 60 * 1000;
  }

  // ---- Status summary -----------------------------------------

  summary() {
    return {
      base: this.baseLocation ? this._key(this.baseLocation) : 'unset',
      deposits: this.resourceDeposits.size,
      dangerZones: this.dangerZones.size,
      chests: this.chestLocations.size,
      exploredCells: this.exploredCells.size,
    };
  }
}

module.exports = MemorySystem;
