"use strict";

/**
 * Dynamic risk assessor.
 * Returns a score [0, 1] where 1 = maximum danger.
 *
 * Components:
 *   Health risk      (0-0.30)
 *   Hunger risk      (0-0.15)
 *   Mob risk         (0-0.30)
 *   Environmental    (0-0.15)
 *   Time/Night       (0-0.10)
 */
class RiskAssessor {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * @param {object} snap - result of perception.scan()
   * @param {object} botStats - { health, food, hasArmor, hasSword }
   * @returns number [0, 1]
   */
  assess(snap, botStats) {
    if (!snap) return 0;

    const score = (
      this._healthRisk(botStats)     +
      this._hungerRisk(botStats)     +
      this._mobRisk(snap, botStats)  +
      this._envRisk(snap)            +
      this._timeRisk(snap)
    );

    const clamped = Math.min(1, Math.max(0, score));
    this.logger.debug("Risk", `Score: ${clamped.toFixed(2)}`);
    return clamped;
  }

  _healthRisk({ health }) {
    if (health <= 4)  return 0.30;
    if (health <= 8)  return 0.20;
    if (health <= 12) return 0.10;
    return 0;
  }

  _hungerRisk({ food }) {
    if (food <= 3)  return 0.15;
    if (food <= 8)  return 0.08;
    if (food <= 12) return 0.03;
    return 0;
  }

  _mobRisk(snap, { hasArmor, hasSword }) {
    const mobs    = snap.hostileMobs ?? [];
    if (!mobs.length) return 0;

    const nearest = mobs[0];
    const dist    = nearest.distance;
    const count   = mobs.length;

    let base = 0;
    if (dist < 4)  base = 0.30;
    else if (dist < 8)  base = 0.20;
    else if (dist < 12) base = 0.10;
    else                base = 0.05;

    // Warden → always max
    if (nearest.name === "warden") return 0.30;

    // Multiplier for multiple mobs
    const countMult = Math.min(2, 1 + (count - 1) * 0.2);

    // Mitigated by armor and weapon
    const mitigation = (hasArmor ? 0.4 : 0) + (hasSword ? 0.2 : 0);

    return Math.min(0.30, base * countMult * (1 - mitigation));
  }

  _envRisk(snap) {
    let risk = 0;
    if (snap.hazards?.length > 0) risk += 0.10;
    if (snap.inWater)              risk += 0.05;
    if (snap.onFire)               risk += 0.15;
    if (snap.fallHeight > 5)       risk += 0.05;
    return Math.min(0.15, risk);
  }

  _timeRisk(snap) {
    if (!snap.isNight) return 0;
    // More hostile spawns at night
    return 0.10;
  }

  shouldAbort(snap, botStats) {
    return this.assess(snap, botStats) >= this.config.risk.abort;
  }

  shouldCaution(snap, botStats) {
    return this.assess(snap, botStats) >= this.config.risk.caution;
  }
}

module.exports = RiskAssessor;
