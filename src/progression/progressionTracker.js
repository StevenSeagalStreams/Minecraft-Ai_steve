"use strict";

/**
 * Minecraft technology tree milestones.
 * Each stage has a name, required conditions (checked against inventory/world),
 * and recommended next goals.
 */
const TECH_STAGES = [
  {
    id: "SPAWN",
    name: "Fresh Spawn",
    achieved: () => true,
    next: ["WOOD_TOOLS"],
  },
  {
    id: "WOOD_TOOLS",
    name: "Wooden Tools",
    achieved: (inv) => inv.has("wooden_pickaxe") && inv.has("wooden_sword"),
    next: ["STONE_TOOLS"],
  },
  {
    id: "STONE_TOOLS",
    name: "Stone Tools + Shelter",
    achieved: (inv, mem) => inv.has("stone_pickaxe") && mem.hasBase(),
    next: ["IRON_TOOLS"],
  },
  {
    id: "IRON_TOOLS",
    name: "Iron Tools",
    achieved: (inv) => inv.has("iron_pickaxe") && inv.has("iron_sword"),
    next: ["IRON_ARMOR"],
  },
  {
    id: "IRON_ARMOR",
    name: "Iron Armor",
    achieved: (inv) => inv.has("iron_chestplate") && inv.has("iron_helmet"),
    next: ["DIAMOND_TOOLS"],
  },
  {
    id: "DIAMOND_TOOLS",
    name: "Diamond Tools",
    achieved: (inv) => inv.has("diamond_pickaxe") && inv.has("diamond_sword"),
    next: ["ENCHANTING"],
  },
  {
    id: "ENCHANTING",
    name: "Enchanting Setup",
    achieved: (inv, _mem, snap) =>
      snap?.craftingTables?.some((b) => b.name === "enchanting_table") ?? false,
    next: ["NETHER_PREP"],
  },
  {
    id: "NETHER_PREP",
    name: "Nether Preparation",
    achieved: (inv) =>
      inv.has("flint_and_steel") && inv.has("diamond_chestplate") && inv.has("golden_apple"),
    next: ["NETHER"],
  },
  {
    id: "NETHER",
    name: "Nether Access",
    achieved: (_inv, mem) => mem.data.portals?.some((p) => p.dimension === "nether") ?? false,
    next: ["BLAZE_FARM"],
  },
  {
    id: "BLAZE_FARM",
    name: "Blaze Rods",
    achieved: (inv) => inv.countOf("blaze_rod") >= 6,
    next: ["END_PREP"],
  },
  {
    id: "END_PREP",
    name: "End Preparation",
    achieved: (inv) => inv.countOf("eye_of_ender") >= 12,
    next: ["DRAGON"],
  },
  {
    id: "DRAGON",
    name: "Dragon Defeated",
    achieved: (_inv, mem) => mem.data.stats?.dragonDefeated ?? false,
    next: ["POST_GAME"],
  },
  {
    id: "POST_GAME",
    name: "Post-Game Automation",
    achieved: (_inv, mem) => mem.data.stats?.dragonDefeated ?? false,
    next: [],
  },
];

class ProgressionTracker {
  constructor(inventory, memory, logger) {
    this.inventory = inventory;
    this.memory    = memory;
    this.logger    = logger;
    this._lastStageId = null;
  }

  currentStage(snap = null) {
    let last = TECH_STAGES[0];
    for (const stage of TECH_STAGES) {
      if (stage.achieved(this.inventory, this.memory, snap)) {
        last = stage;
      } else {
        break;
      }
    }
    if (last.id !== this._lastStageId) {
      this.logger.info("Progression", `★ Stage reached: ${last.name}`);
      this._lastStageId = last.id;
    }
    return last;
  }

  nextGoals(snap = null) {
    const stage = this.currentStage(snap);
    return stage.next;
  }

  summary(snap = null) {
    const achieved = TECH_STAGES.filter((s) => s.achieved(this.inventory, this.memory, snap));
    return {
      currentStage: this.currentStage(snap).name,
      stagesComplete: achieved.length,
      totalStages: TECH_STAGES.length,
      nextGoals: this.nextGoals(snap),
    };
  }
}

module.exports = { ProgressionTracker, TECH_STAGES };
