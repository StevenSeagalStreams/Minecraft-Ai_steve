"use strict";

const { WorldState, capture } = require("./goap/worldState");
const ACTIONS                 = require("./goap/actions");
const GOAPPlanner             = require("./goap/planner");
const MODULE = "Strategy";

/**
 * Strategic Planner: long-term goal management.
 *
 * Runs the GOAP planner to produce multi-step plans, then hands
 * individual action names to the TacticalController for execution.
 *
 * Also monitors when plans fail and switches goals (risk-aware).
 */
class StrategicPlanner {
  constructor(systems, config, logger, eventBus) {
    this.systems    = systems;
    this.config     = config;
    this.logger     = logger;
    this.eventBus   = eventBus;
    this.planner    = new GOAPPlanner(ACTIONS, config, logger);
    this.currentPlan= [];   // remaining action names
    this.currentGoal= null; // WorldState describing goal
    this._planFails = 0;
  }

  /** Select a goal WorldState appropriate for the current game stage. */
  selectGoal(worldState, progression) {
    const nextGoals = progression.nextGoals();

    const goalMap = {
      WOOD_TOOLS:   new WorldState({ hasWoodenPickaxe: true, hasWoodenSword: true }),
      STONE_TOOLS:  new WorldState({ hasStonePickaxe: true, hasStoneSword: true, hasBase: true }),
      IRON_TOOLS:   new WorldState({ hasIronPickaxe: true, hasIronSword: true }),
      IRON_ARMOR:   new WorldState({ hasIronArmor: true }),
      DIAMOND_TOOLS:new WorldState({ hasDiamondPickaxe: true }),
      ENCHANTING:   new WorldState({ hasEnchantingTable: true }),
      NETHER_PREP:  new WorldState({ hasFoodReserve: true, hasIronArmor: true }),
      DEFAULT:      new WorldState({ hasWoodenPickaxe: true }),
    };

    for (const goal of nextGoals) {
      if (goalMap[goal]) return goalMap[goal];
    }
    return goalMap.DEFAULT;
  }

  /**
   * Returns the next action name to execute, replanning if necessary.
   */
  nextAction(worldState, progression) {
    // Replan if plan is empty or goal changed
    if (this.currentPlan.length === 0 || this._goalChanged(progression)) {
      this.currentGoal = this.selectGoal(worldState, progression);
      this.logger.info(MODULE, `Planning towards: ${JSON.stringify(this.currentGoal.toJSON())}`);
      this.currentPlan = this.planner.plan(worldState, this.currentGoal) ?? [];
      if (!this.currentPlan.length) {
        this._planFails++;
        this.logger.warn(MODULE, `No plan found (attempt ${this._planFails}). Exploring.`);
        return "Explore";
      }
      this._planFails = 0;
      this.logger.info(MODULE, `Plan: [${this.currentPlan.join(" → ")}]`);
    }

    return this.currentPlan[0];
  }

  /** Advance to the next action in the plan after the current one succeeds. */
  advance() {
    if (this.currentPlan.length) {
      const done = this.currentPlan.shift();
      this.logger.info(MODULE, `Completed action: ${done}`);
      this.eventBus.emit("goal:step", { action: done, remaining: this.currentPlan.length });
    }
  }

  /** Reset the plan (e.g. after a failure or survival interruption). */
  reset() {
    this.currentPlan = [];
  }

  _goalChanged(progression) {
    const next = progression.nextGoals().join(",");
    const prev = this._lastGoalKey;
    this._lastGoalKey = next;
    return next !== prev;
  }
}

module.exports = StrategicPlanner;
