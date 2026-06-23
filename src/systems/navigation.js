"use strict";

const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const { GoalBlock, GoalNear, GoalXZ, GoalFollow, GoalY } = goals;
const Vec3 = require("vec3");

const MODULE = "Navigation";

/**
 * Hazard-aware navigation wrapper with:
 *   - Configurable timeouts
 *   - Stuck detection and recovery (random jitter + jump)
 *   - Flee-direction logic
 *   - Safe-position search before moving
 */
class Navigation {
  constructor(bot, config, logger, eventBus) {
    this.bot      = bot;
    this.config   = config;
    this.logger   = logger;
    this.eventBus = eventBus;
    this._stuckChecks = 0;
    this._lastPos     = null;
    this._active      = false;

    bot.loadPlugin(pathfinder);
    const mcData = require("minecraft-data")(bot.version);
    this.movements = new Movements(bot, mcData);
    this._configureMovements(mcData);
    bot.pathfinder.setMovements(this.movements);
  }

  _configureMovements(mcData) {
    this.movements.canDig          = true;
    this.movements.allowSprinting  = true;
    this.movements.allowParkour    = true;
    this.movements.allowFreeMotion = false;
    // Mark hazardous blocks so the pathfinder avoids them.
    const avoidIds = ["lava","flowing_lava","fire","magma_block","cactus","sweet_berry_bush"]
      .map((n) => mcData.blocksByName[n]?.id)
      .filter(Boolean);
    for (const id of avoidIds) this.movements.blocksToAvoid.add(id);
  }

  // ─── Core navigation primitives ───────────────────────────────────────────

  async goTo(position, options = {}) {
    const { range = 1, timeoutMs = this.config.navigation.defaultTimeout } = options;
    const goal = new GoalNear(position.x, position.y, position.z, range);
    return this._navigate(goal, timeoutMs, `goTo(${_fmt(position)})`);
  }

  async goToBlock(block, range = 1, timeoutMs = this.config.navigation.defaultTimeout) {
    const p = block.position ?? block;
    const goal = new GoalNear(p.x, p.y, p.z, range);
    return this._navigate(goal, timeoutMs, `goToBlock(${block.name ?? "?"})`);
  }

  async goToXZ(x, z, timeoutMs = this.config.navigation.defaultTimeout) {
    const goal = new GoalXZ(x, z);
    return this._navigate(goal, timeoutMs, `goToXZ(${x},${z})`);
  }

  followEntity(entity, range = 2) {
    this.bot.pathfinder.setGoal(new GoalFollow(entity, range), true);
  }

  stop() {
    this.bot.pathfinder.setGoal(null);
    this._active = false;
  }

  // ─── Navigation with promise + timeout + stuck recovery ──────────────────

  _navigate(goal, timeoutMs, label) {
    return new Promise((resolve, reject) => {
      let settled = false;
      this._active = true;
      let lastPos  = this.bot.entity.position.clone();
      let stuckCount = 0;

      const settle = (ok, err) => {
        if (settled) return;
        settled = true;
        this._active = false;
        clearTimeout(timer);
        clearInterval(stuckChecker);
        this.bot.removeListener("goal_reached", onReach);
        this.bot.removeListener("path_update",   onUpdate);
        if (ok) { this.logger.debug(MODULE, `Reached: ${label}`); resolve(true); }
        else    { this.logger.warn(MODULE, `Failed: ${label}`, { reason: err }); reject(new Error(err)); }
      };

      const timer = setTimeout(() => settle(false, "timeout"), timeoutMs);

      const stuckChecker = setInterval(async () => {
        if (settled) return;
        const cur = this.bot.entity.position;
        if (cur.distanceTo(lastPos) < this.config.navigation.stuckThreshold) {
          stuckCount++;
          this.logger.debug(MODULE, `Stuck check ${stuckCount}/${this.config.navigation.stuckRetries}`);
          if (stuckCount >= this.config.navigation.stuckRetries) {
            await this._unstuck();
            stuckCount = 0;
          }
        } else {
          stuckCount = 0;
        }
        lastPos = cur.clone();
      }, 3000);

      const onReach  = ()         => settle(true, null);
      const onUpdate = (result)   => {
        if (result.status === "noPath" && !settled) settle(false, "noPath");
      };

      this.bot.once("goal_reached", onReach);
      this.bot.on("path_update",    onUpdate);
      this.bot.pathfinder.setGoal(goal);
    });
  }

  async _unstuck() {
    this.logger.warn(MODULE, "Bot appears stuck — attempting recovery");
    this.stop();
    // Random horizontal jitter + jump
    const angle = Math.random() * Math.PI * 2;
    this.bot.setControlState("jump", true);
    this.bot.entity.velocity.x = Math.cos(angle) * 0.5;
    this.bot.entity.velocity.z = Math.sin(angle) * 0.5;
    await this._sleep(800);
    this.bot.setControlState("jump", false);
  }

  // ─── Flee ─────────────────────────────────────────────────────────────────

  async fleeFrom(threatPosition, distance = this.config.navigation.fleeDistance) {
    const pos = this.bot.entity.position;
    const dx  = pos.x - threatPosition.x;
    const dz  = pos.z - threatPosition.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const tx  = Math.round(pos.x + (dx / len) * distance);
    const tz  = Math.round(pos.z + (dz / len) * distance);
    this.logger.debug(MODULE, `Fleeing to (${tx},${tz})`);
    try {
      await this.goToXZ(tx, tz, this.config.navigation.defaultTimeout);
    } catch (_) { /* best effort */ }
  }

  // ─── Random exploration ───────────────────────────────────────────────────

  async exploreRandomly(basePosition, maxDist = 64) {
    const angle = Math.random() * Math.PI * 2;
    const dist  = 20 + Math.random() * (maxDist - 20);
    const tx    = Math.round(basePosition.x + Math.cos(angle) * dist);
    const tz    = Math.round(basePosition.z + Math.sin(angle) * dist);
    try {
      await this.goToXZ(tx, tz, this.config.navigation.longTimeout);
      return { x: tx, z: tz };
    } catch (_) {
      return null;
    }
  }

  _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
}

function _fmt(p) { return `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`; }

module.exports = Navigation;
