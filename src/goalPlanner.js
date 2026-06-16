"use strict";

/**
 * Goal-oriented planner: tracks the bot's overall progression
 * (wood -> stone -> iron tools, shelter, storage) and exposes the next
 * actionable task for the main state machine to execute.
 */
const STAGES = ["WOOD_TOOLS", "SHELTER", "STONE_TOOLS", "STORAGE", "IRON_TOOLS", "MAINTAIN"];

class GoalPlanner {
  constructor(inventory, memory, buildingSystem) {
    this.inventory = inventory;
    this.memory = memory;
    this.buildingSystem = buildingSystem;
    this.currentStage = STAGES[0];
  }

  hasWoodenTools() {
    return (
      this.inventory.hasItem("wooden_pickaxe") &&
      this.inventory.hasItem("wooden_axe") &&
      this.inventory.hasItem("wooden_sword")
    );
  }

  hasStoneTools() {
    return (
      this.inventory.hasItem("stone_pickaxe") &&
      this.inventory.hasItem("stone_axe") &&
      this.inventory.hasItem("stone_sword")
    );
  }

  hasIronTools() {
    return (
      this.inventory.hasItem("iron_pickaxe") &&
      this.inventory.hasItem("iron_axe") &&
      this.inventory.hasItem("iron_sword")
    );
  }

  hasShelter() {
    return this.memory.hasBase();
  }

  hasStorage() {
    return this.memory.chestLocations.length > 0;
  }

  /** Re-evaluates progression and returns the current high level stage. */
  evaluate() {
    if (!this.hasWoodenTools()) {
      this.currentStage = "WOOD_TOOLS";
    } else if (!this.hasShelter()) {
      this.currentStage = "SHELTER";
    } else if (!this.hasStoneTools()) {
      this.currentStage = "STONE_TOOLS";
    } else if (!this.hasStorage()) {
      this.currentStage = "STORAGE";
    } else if (!this.hasIronTools()) {
      this.currentStage = "IRON_TOOLS";
    } else {
      this.currentStage = "MAINTAIN";
    }
    this.memory.lastKnownGoal = this.currentStage;
    return this.currentStage;
  }

  /** Translates the current stage into a concrete task descriptor. */
  getNextTask() {
    const stage = this.evaluate();
    switch (stage) {
      case "WOOD_TOOLS":
        return { type: "GATHER", resource: "wood", amount: 8, then: "CRAFT_WOOD_TOOLS" };
      case "SHELTER":
        return { type: "BUILD", target: "shelter" };
      case "STONE_TOOLS":
        return { type: "GATHER", resource: "stone", amount: 16, then: "CRAFT_STONE_TOOLS" };
      case "STORAGE":
        return { type: "BUILD", target: "storage" };
      case "IRON_TOOLS":
        return { type: "GATHER", resource: "iron", amount: 6, then: "CRAFT_IRON_TOOLS" };
      case "MAINTAIN":
      default:
        return { type: "MAINTAIN" };
    }
  }
}

module.exports = GoalPlanner;
