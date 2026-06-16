"use strict";

const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const { GoalBlock, GoalNear, GoalXZ, GoalY, GoalFollow } = goals;

/**
 * Wraps mineflayer-pathfinder with hazard-aware movement helpers.
 */
class Navigation {
  constructor(bot) {
    this.bot = bot;
    this.bot.loadPlugin(pathfinder);

    const mcData = require("minecraft-data")(bot.version);
    this.movements = new Movements(bot, mcData);
    this.movements.canDig = true;
    this.movements.allowSprinting = true;
    // Avoid digging through hazardous blocks and never path through lava.
    this.movements.blocksToAvoid.add(mcData.blocksByName.lava?.id);
    this.bot.pathfinder.setMovements(this.movements);
  }

  /** Move to an exact block position. */
  async goTo(position, options = {}) {
    const { range = 1, timeoutMs = 30000 } = options;
    const goal = new GoalNear(position.x, position.y, position.z, range);
    return this._navigate(goal, timeoutMs);
  }

  /** Move to specific X/Z, any Y (useful for long-range travel). */
  async goToXZ(x, z, timeoutMs = 30000) {
    const goal = new GoalXZ(x, z);
    return this._navigate(goal, timeoutMs);
  }

  /** Move next to a specific block (mining / interacting range). */
  async goNearBlock(block, range = 1, timeoutMs = 20000) {
    const goal = new GoalNear(
      block.position.x,
      block.position.y,
      block.position.z,
      range
    );
    return this._navigate(goal, timeoutMs);
  }

  /** Follow an entity (e.g. fleeing or escorting). */
  followEntity(entity, range = 2) {
    const goal = new GoalFollow(entity, range);
    this.bot.pathfinder.setGoal(goal, true);
  }

  stop() {
    this.bot.pathfinder.setGoal(null);
  }

  async _navigate(goal, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.bot.pathfinder.setGoal(null);
        reject(new Error("Navigation timed out"));
      }, timeoutMs);

      const onGoalReached = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve(true);
      };

      const onPathUpdate = (result) => {
        if (settled) return;
        if (result.status === "noPath") {
          settled = true;
          clearTimeout(timer);
          cleanup();
          reject(new Error("No path found"));
        }
      };

      const cleanup = () => {
        this.bot.removeListener("goal_reached", onGoalReached);
        this.bot.removeListener("path_update", onPathUpdate);
      };

      this.bot.once("goal_reached", onGoalReached);
      this.bot.on("path_update", onPathUpdate);
      this.bot.pathfinder.setGoal(goal);
    });
  }

  /** Flee away from a threat position by moving to a point further away. */
  async fleeFrom(threatPosition, distance = 12) {
    const pos = this.bot.entity.position;
    const dx = pos.x - threatPosition.x;
    const dz = pos.z - threatPosition.z;
    const length = Math.sqrt(dx * dx + dz * dz) || 1;
    const targetX = pos.x + (dx / length) * distance;
    const targetZ = pos.z + (dz / length) * distance;
    try {
      await this.goToXZ(Math.round(targetX), Math.round(targetZ), 15000);
    } catch (_) {
      // Best effort; ignore navigation failures while fleeing.
    }
  }

  isStuck(lastPosition, currentPosition, threshold = 0.05) {
    return lastPosition.distanceTo(currentPosition) < threshold;
  }
}

module.exports = Navigation;
