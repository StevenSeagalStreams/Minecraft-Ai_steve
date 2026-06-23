// learningSystem.js — Simple persistent learning
// Remembers: good tree locations, safe zones, death patterns
// Persists to disk so knowledge survives restarts

const fs   = require('fs');
const path = require('path');
const SAVE_FILE = path.join(__dirname, 'bot_memory.json');

class LearningSystem {
  constructor(bot) {
    this.bot = bot;
    this.data = {
      goodTreeAreas:  [],   // {x,z} areas with reliable trees
      deathCauses:    {},   // cause -> count
      survivalStreak: 0,    // consecutive days survived
      totalDeaths:    0,
      craftingSuccess:{},   // itemName -> successRate
      stoneAreas:     [],   // {x,y,z} reliable stone spots
    };
    this._load();
    this._dirty = false;
    // Auto-save every 2 minutes
    setInterval(() => { if (this._dirty) this._save(); }, 120000);
    console.log('[Learning] System initialised. Deaths so far:', this.data.totalDeaths);
  }

  // ── deaths ────────────────────────────────────────────────

  recordDeath(cause, pos) {
    this.data.totalDeaths++;
    this.data.survivalStreak = 0;
    this.data.deathCauses[cause] = (this.data.deathCauses[cause] || 0) + 1;
    this._dirty = true;

    const topCause = this._topDeathCause();
    console.log('[Learning] Death #' + this.data.totalDeaths +
      ' by ' + cause + '. Biggest killer: ' + topCause);

    // Log lesson learned
    if (this.data.deathCauses[cause] >= 3) {
      console.log('[Learning] Lesson: avoid ' + cause + ' — died ' +
        this.data.deathCauses[cause] + ' times to it');
    }

    // Detect rapid death clustering — dying repeatedly near the same
    // coordinates within a short time window almost always means the
    // current respawn point itself is hazardous (mob spawner nearby,
    // in/near water, etc). isInDeathCluster() lets main.js react by
    // prioritizing a long escape over normal goal logic.
    const now = Date.now();
    if (pos && this._lastDeathPos && this._lastDeathTime) {
      const dist = Math.hypot(pos.x - this._lastDeathPos.x, pos.z - this._lastDeathPos.z);
      const timeSince = now - this._lastDeathTime;
      if (dist < 25 && timeSince < 60000) {
        this._clusterDeathCount = (this._clusterDeathCount || 0) + 1;
      } else {
        this._clusterDeathCount = 0;
      }
    }
    this._lastDeathPos  = pos ? { x: pos.x, y: pos.y, z: pos.z } : null;
    this._lastDeathTime = now;

    if (this._clusterDeathCount >= 2) {
      console.warn('[Learning] *** Dying repeatedly near the same spot (' +
        (this._clusterDeathCount + 1) + 'x) — likely a hazardous respawn area ***');
    }
  }

  /** True if the bot has died 3+ times near the same spot within the last minute. */
  isInDeathCluster() {
    return (this._clusterDeathCount || 0) >= 2;
  }

  _topDeathCause() {
    let top = 'unknown', max = 0;
    for (const [cause, count] of Object.entries(this.data.deathCauses)) {
      if (count > max) { max = count; top = cause; }
    }
    return top + ' (' + max + 'x)';
  }

  recordSurvival() {
    this.data.survivalStreak++;
    this._dirty = true;
    if (this.data.survivalStreak % 5 === 0) {
      console.log('[Learning] Survived ' + this.data.survivalStreak + ' days in a row!');
    }
  }

  // ── good resource spots ───────────────────────────────────

  recordGoodTreeArea(pos) {
    // Keep last 10 good tree areas
    this.data.goodTreeAreas.push({ x: Math.floor(pos.x), z: Math.floor(pos.z) });
    if (this.data.goodTreeAreas.length > 10) this.data.goodTreeAreas.shift();
    this._dirty = true;
  }

  recordGoodStoneArea(pos) {
    this.data.stoneAreas.push({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
    if (this.data.stoneAreas.length > 10) this.data.stoneAreas.shift();
    this._dirty = true;
  }

  getNearestGoodTreeArea(fromPos) {
    if (!this.data.goodTreeAreas.length) return null;
    return this.data.goodTreeAreas.reduce((best, a) => {
      const d = Math.hypot(fromPos.x - a.x, fromPos.z - a.z);
      const bd = best ? Math.hypot(fromPos.x - best.x, fromPos.z - best.z) : Infinity;
      return d < bd ? a : best;
    }, null);
  }

  getNearestGoodStoneArea(fromPos) {
    if (!this.data.stoneAreas.length) return null;
    return this.data.stoneAreas.reduce((best, a) => {
      const d = Math.hypot(fromPos.x - a.x, fromPos.z - a.z);
      const bd = best ? Math.hypot(fromPos.x - best.x, fromPos.z - best.z) : Infinity;
      return d < bd ? a : best;
    }, null);
  }

  // ── crafting success tracking ─────────────────────────────

  recordCraftingAttempt(itemName, success) {
    if (!this.data.craftingSuccess[itemName]) {
      this.data.craftingSuccess[itemName] = { success: 0, fail: 0 };
    }
    if (success) this.data.craftingSuccess[itemName].success++;
    else          this.data.craftingSuccess[itemName].fail++;
    this._dirty = true;
  }

  // ── combat learning ───────────────────────────────────────

  shouldFightOrFlee(mobType, currentHP) {
    const deaths = this.data.deathCauses[mobType] || 0;
    // If died to this mob type 3+ times and below half health, flee
    if (deaths >= 3 && currentHP < 12) return 'flee';
    // Always flee from creepers if low health
    if (mobType === 'creeper' && currentHP < 15) return 'flee';
    return 'fight';
  }

  // ── status ────────────────────────────────────────────────

  summary() {
    return {
      totalDeaths: this.data.totalDeaths,
      topKiller: this._topDeathCause(),
      survivalStreak: this.data.survivalStreak,
      knownTreeAreas: this.data.goodTreeAreas.length,
      knownStoneAreas: this.data.stoneAreas.length,
    };
  }

  // ── persistence ───────────────────────────────────────────

  _save() {
    try {
      fs.writeFileSync(SAVE_FILE, JSON.stringify(this.data, null, 2));
      this._dirty = false;
    } catch(e) {
      console.warn('[Learning] Could not save:', e.message);
    }
  }

  _load() {
    try {
      if (fs.existsSync(SAVE_FILE)) {
        const saved = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
        this.data = Object.assign(this.data, saved);
        console.log('[Learning] Loaded memory — ' + this.data.totalDeaths + ' past deaths');
      }
    } catch(e) {
      console.warn('[Learning] Could not load memory:', e.message);
    }
  }
}

module.exports = LearningSystem;
