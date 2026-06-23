// activityLog.js — Structured, queryable log of what the bot does and learns
// Writes to activity_log.json (rolling, last N entries) so you can inspect
// exactly what happened, when, and what the bot concluded from it.

const fs   = require('fs');
const path = require('path');
const LOG_FILE = path.join(__dirname, 'activity_log.json');
const MAX_ENTRIES = 500;

class ActivityLog {
  constructor() {
    this.entries = [];
    this._load();
  }

  _timestamp() {
    return new Date().toISOString().slice(11, 19); // HH:MM:SS
  }

  _push(entry) {
    entry.t = this._timestamp();
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this._save();
  }

  // ── action logging ────────────────────────────────────────

  logGoal(goalId, taskName) {
    this._push({ type: 'goal', goal: goalId, task: taskName });
  }

  logCombat(mobName, weaponUsed, outcome, hpBefore, hpAfter) {
    this._push({
      type: 'combat', mob: mobName, weapon: weaponUsed || 'none',
      outcome, hpLost: +(hpBefore - hpAfter).toFixed(1),
    });
  }

  logToolUsage(toolName, action, target) {
    this._push({ type: 'tool_use', tool: toolName || 'none', action, target });
  }

  logDeath(cause, pos, equippedAtDeath) {
    this._push({
      type: 'death', cause,
      pos: pos ? Math.floor(pos.x)+','+Math.floor(pos.y)+','+Math.floor(pos.z) : null,
      heldItem: equippedAtDeath || 'none (fist)',
    });
  }

  logShelterProgress(stage, detail) {
    this._push({ type: 'shelter', stage, detail });
  }

  // ── weapon-effectiveness learning ─────────────────────────
  // Tracks: for each mob type, which weapon was held when bot
  // (a) won the fight without dying, (b) died fighting it.

  recordWeaponOutcome(mobName, weaponName, won) {
    this._push({
      type: 'weapon_learning', mob: mobName,
      weapon: weaponName || 'fist', result: won ? 'won' : 'died',
    });
  }

  bestWeaponFor(mobName) {
    const records = this.entries.filter(e =>
      e.type === 'weapon_learning' && e.mob === mobName
    );
    if (!records.length) return null;

    const tally = {}; // weapon -> {win, loss}
    for (const r of records) {
      if (!tally[r.weapon]) tally[r.weapon] = { win: 0, loss: 0 };
      if (r.result === 'won') tally[r.weapon].win++;
      else tally[r.weapon].loss++;
    }

    let best = null, bestRate = -1;
    for (const [weapon, stats] of Object.entries(tally)) {
      const total = stats.win + stats.loss;
      if (total < 2) continue; // need at least 2 data points
      const rate = stats.win / total;
      if (rate > bestRate) { bestRate = rate; best = weapon; }
    }
    return best ? { weapon: best, winRate: (bestRate*100).toFixed(0) + '%' } : null;
  }

  // ── reporting ──────────────────────────────────────────────

  /** Returns a compact summary string for chat output */
  summaryForChat() {
    const deaths = this.entries.filter(e => e.type === 'death');
    const combats = this.entries.filter(e => e.type === 'combat');
    const noWeaponFights = combats.filter(e => e.weapon === 'none').length;

    const causeCounts = {};
    for (const d of deaths) causeCounts[d.cause] = (causeCounts[d.cause]||0) + 1;
    const topCause = Object.entries(causeCounts).sort((a,b)=>b[1]-a[1])[0];

    return {
      totalDeaths: deaths.length,
      topCause: topCause ? topCause[0] + ' (' + topCause[1] + 'x)' : 'none',
      fightsWithNoWeapon: noWeaponFights,
      totalFights: combats.length,
    };
  }

  /** Returns last N entries of a given type, newest first */
  recent(type, n) {
    n = n || 10;
    return this.entries.filter(e => !type || e.type === type).slice(-n).reverse();
  }

  /** Per-mob weapon effectiveness report */
  weaponReport() {
    const mobs = new Set(this.entries.filter(e => e.type === 'weapon_learning').map(e => e.mob));
    const report = {};
    for (const mob of mobs) {
      report[mob] = this.bestWeaponFor(mob);
    }
    return report;
  }

  // ── persistence ───────────────────────────────────────────

  _save() {
    try {
      fs.writeFileSync(LOG_FILE, JSON.stringify(this.entries, null, 1));
    } catch(e) {}
  }

  _load() {
    try {
      if (fs.existsSync(LOG_FILE)) {
        this.entries = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
      }
    } catch(e) {
      this.entries = [];
    }
  }
}

module.exports = ActivityLog;
