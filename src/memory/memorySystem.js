"use strict";

const fs   = require("fs");
const path = require("path");

/**
 * Persistent-across-restart memory store.
 * All geometric positions are stored as plain {x,y,z} objects.
 *
 * Schema
 * ------
 * base         - primary base position + phase
 * resources    - { [type]: [{x,y,z,discoveredAt,depleted}] }
 * dangerZones  - [{x,y,z,radius,reason,timestamp}]
 * chests       - [{x,y,z,label,lastKnownContents}]
 * deaths       - [{x,y,z,cause,items,timestamp,recovered}]
 * exploration  - Set of chunk keys "cx,cz" serialised to array
 * strategies   - { [key]: {successes, failures, lastUsed} }
 * beds         - [{x,y,z}]
 * farms        - [{x,y,z,type,size}]
 * portals      - [{x,y,z,dimension,linkedTo}]
 * stats        - counters
 */
class MemorySystem {
  constructor(config, logger) {
    this.filePath = config.memoryFile;
    this.logger   = logger;
    this.data     = this._load();
    this._dirty   = false;
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  _defaults() {
    return {
      base:        null,
      resources:   {},
      dangerZones: [],
      chests:      [],
      deaths:      [],
      exploration: [],
      strategies:  {},
      beds:        [],
      farms:       [],
      portals:     [],
      stats: {
        blocksMined:    0,
        mobsKilled:     0,
        deaths:         0,
        itemsCrafted:   0,
        metersWalked:   0,
        daysSurvived:   0,
      },
    };
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8");
        this.logger && this.logger.info("Memory", "Loaded persistent memory from disk");
        return Object.assign(this._defaults(), JSON.parse(raw));
      }
    } catch (err) {
      this.logger && this.logger.warn("Memory", "Failed to load memory file, starting fresh", { err: err.message });
    }
    return this._defaults();
  }

  save() {
    if (!this._dirty) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
      this._dirty = false;
    } catch (err) {
      this.logger && this.logger.error("Memory", "Failed to save memory", { err: err.message });
    }
  }

  _mark() { this._dirty = true; }

  // ─── Base ─────────────────────────────────────────────────────────────────

  setBase(position, phase = 1) {
    this.data.base = { x: position.x, y: position.y, z: position.z, phase };
    this._mark();
  }

  get base() { return this.data.base; }
  hasBase()  { return this.data.base !== null; }

  setBasePhase(phase) {
    if (this.data.base) { this.data.base.phase = phase; this._mark(); }
  }

  // ─── Resources ────────────────────────────────────────────────────────────

  rememberResource(type, position) {
    if (!this.data.resources[type]) this.data.resources[type] = [];
    const key = `${Math.round(position.x)},${Math.round(position.y)},${Math.round(position.z)}`;
    const exists = this.data.resources[type].find((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.z)}` === key);
    if (!exists) {
      this.data.resources[type].push({
        x: position.x, y: position.y, z: position.z,
        discoveredAt: Date.now(), depleted: false,
      });
      this._mark();
    }
  }

  markDepleted(type, position) {
    const list = this.data.resources[type] || [];
    for (const r of list) {
      if (Math.abs(r.x - position.x) < 2 && Math.abs(r.z - position.z) < 2) {
        r.depleted = true; this._mark();
      }
    }
  }

  getNearestResource(type, position) {
    const list = (this.data.resources[type] || []).filter((r) => !r.depleted);
    return _nearest(list, position);
  }

  // ─── Danger Zones ─────────────────────────────────────────────────────────

  markDanger(position, radius, reason) {
    this.data.dangerZones.push({
      x: position.x, y: position.y, z: position.z,
      radius, reason, timestamp: Date.now(),
    });
    if (this.data.dangerZones.length > 300) this.data.dangerZones.shift();
    this._mark();
  }

  isDangerous(position) {
    return this.data.dangerZones.some((z) => _dist(z, position) <= z.radius);
  }

  clearOldDangers(ageMs = 600000) {
    const now = Date.now();
    const before = this.data.dangerZones.length;
    this.data.dangerZones = this.data.dangerZones.filter((z) => now - z.timestamp < ageMs);
    if (this.data.dangerZones.length !== before) this._mark();
  }

  // ─── Chests ───────────────────────────────────────────────────────────────

  addChest(position, label = "") {
    const exists = this.data.chests.find((c) => _dist(c, position) < 1);
    if (!exists) {
      this.data.chests.push({ x: position.x, y: position.y, z: position.z, label, lastKnownContents: {} });
      this._mark();
    }
  }

  updateChestContents(position, contents) {
    const chest = this.data.chests.find((c) => _dist(c, position) < 1);
    if (chest) { chest.lastKnownContents = contents; this._mark(); }
  }

  getNearestChest(position) {
    return _nearest(this.data.chests, position);
  }

  get chests() { return this.data.chests; }

  // ─── Deaths ───────────────────────────────────────────────────────────────

  recordDeath(position, cause, items) {
    this.data.deaths.push({
      x: position.x, y: position.y, z: position.z,
      cause, items, timestamp: Date.now(), recovered: false,
    });
    this.data.stats.deaths++;
    this._mark();
  }

  getLastDeath() {
    return this.data.deaths.filter((d) => !d.recovered).pop() || null;
  }

  markDeathRecovered(index) {
    if (this.data.deaths[index]) {
      this.data.deaths[index].recovered = true; this._mark();
    }
  }

  markLastDeathRecovered() {
    const deaths = this.data.deaths.filter((d) => !d.recovered);
    if (deaths.length > 0) {
      deaths[deaths.length - 1].recovered = true; this._mark();
    }
  }

  // ─── Exploration ──────────────────────────────────────────────────────────

  markChunkVisited(cx, cz) {
    const key = `${cx},${cz}`;
    if (!this.data.exploration.includes(key)) {
      this.data.exploration.push(key); this._mark();
    }
  }

  isChunkVisited(cx, cz) {
    return this.data.exploration.includes(`${cx},${cz}`);
  }

  // ─── Beds ─────────────────────────────────────────────────────────────────

  addBed(position) {
    if (!this.data.beds.find((b) => _dist(b, position) < 2)) {
      this.data.beds.push({ x: position.x, y: position.y, z: position.z });
      this._mark();
    }
  }

  getNearestBed(position) {
    return _nearest(this.data.beds, position);
  }

  // ─── Farms ────────────────────────────────────────────────────────────────

  addFarm(position, type, size) {
    this.data.farms.push({ x: position.x, y: position.y, z: position.z, type, size });
    this._mark();
  }

  // ─── Portals ──────────────────────────────────────────────────────────────

  addPortal(position, dimension) {
    if (!this.data.portals.find((p) => _dist(p, position) < 4)) {
      this.data.portals.push({ x: position.x, y: position.y, z: position.z, dimension });
      this._mark();
    }
  }

  // ─── Strategy Learning ────────────────────────────────────────────────────

  recordSuccess(strategy) {
    if (!this.data.strategies[strategy]) this.data.strategies[strategy] = { successes: 0, failures: 0, lastUsed: 0 };
    this.data.strategies[strategy].successes++;
    this.data.strategies[strategy].lastUsed = Date.now();
    this._mark();
  }

  recordFailure(strategy) {
    if (!this.data.strategies[strategy]) this.data.strategies[strategy] = { successes: 0, failures: 0, lastUsed: 0 };
    this.data.strategies[strategy].failures++;
    this._mark();
  }

  strategyScore(strategy) {
    const s = this.data.strategies[strategy];
    if (!s || (s.successes + s.failures) === 0) return 0.5;
    return s.successes / (s.successes + s.failures);
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  increment(stat, amount = 1) {
    this.data.stats[stat] = (this.data.stats[stat] || 0) + amount;
    this._mark();
  }

  get stats() { return { ...this.data.stats }; }
}

// Utility helpers
function _dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function _nearest(list, position) {
  if (!list || list.length === 0) return null;
  let best = null, bestD = Infinity;
  for (const item of list) {
    const d = _dist(item, position);
    if (d < bestD) { bestD = d; best = item; }
  }
  return best;
}

module.exports = MemorySystem;
