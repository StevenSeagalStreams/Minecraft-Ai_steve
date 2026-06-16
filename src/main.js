"use strict";

const mineflayer = require("mineflayer");
const config = require("../config");

const { Perception } = require("./perception");
const Navigation = require("./navigation");
const InventoryManager = require("./inventoryManager");
const ResourceManager = require("./resourceManager");
const CraftingSystem = require("./craftingSystem");
const StorageSystem = require("./storageSystem");
const CombatSystem = require("./combatSystem");
const SurvivalSystem = require("./survivalSystem");
const BuildingSystem = require("./buildingSystem");
const GoalPlanner = require("./goalPlanner");
const MemorySystem = require("./memorySystem");

const STATES = {
  IDLE: "IDLE",
  EXPLORE: "EXPLORE",
  GATHER: "GATHER",
  CRAFT: "CRAFT",
  BUILD: "BUILD",
  COMBAT: "COMBAT",
  SURVIVE: "SURVIVE",
};

/**
 * Central controller: owns the bot connection, wires up every subsystem
 * and runs the top-level state machine that drives autonomous behaviour.
 */
class AiSteve {
  constructor(cfg) {
    this.config = cfg;
    this.state = STATES.IDLE;
    this.bot = null;
    this.running = false;
    this.currentTask = null;
  }

  connect() {
    this.bot = mineflayer.createBot({
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      password: this.config.password,
      auth: this.config.auth,
      version: this.config.version,
    });

    this.bot.once("spawn", () => this._onSpawn());
    this.bot.on("kicked", (reason) => console.error("[AiSteve] Kicked:", reason));
    this.bot.on("error", (err) => console.error("[AiSteve] Error:", err));
    this.bot.on("death", () => this._onDeath());
    this.bot.on("end", () => {
      console.log("[AiSteve] Disconnected.");
      this.running = false;
    });
  }

  _onSpawn() {
    console.log("[AiSteve] Spawned. Initializing subsystems...");

    this.memory = new MemorySystem();
    this.perception = new Perception(this.bot);
    this.navigation = new Navigation(this.bot);
    this.inventory = new InventoryManager(this.bot, this.config);
    this.resources = new ResourceManager(
      this.bot,
      this.perception,
      this.navigation,
      this.inventory,
      this.memory
    );
    this.crafting = new CraftingSystem(this.bot, this.navigation, this.inventory, this.memory);
    this.storage = new StorageSystem(this.bot, this.navigation, this.inventory, this.memory);
    this.combat = new CombatSystem(
      this.bot,
      this.perception,
      this.navigation,
      this.inventory,
      this.memory,
      this.config
    );
    this.survival = new SurvivalSystem(
      this.bot,
      this.perception,
      this.navigation,
      this.inventory,
      this.memory,
      this.config
    );
    this.building = new BuildingSystem(this.bot, this.navigation, this.inventory, this.memory);
    this.goalPlanner = new GoalPlanner(this.inventory, this.memory, this.building);

    this.running = true;
    this._mainLoop();
  }

  _onDeath() {
    console.log("[AiSteve] Died. Respawning and marking danger zone.");
    this.memory.incrementStat("deaths");
    if (this.bot.entity) {
      this.memory.markDanger(this.bot.entity.position, 10, "death");
    }
    this.state = STATES.IDLE;
  }

  async _mainLoop() {
    while (this.running) {
      try {
        await this._tick();
      } catch (err) {
        console.error("[AiSteve] Tick error:", err.message);
      }
      await this._sleep(this.config.tickIntervalMs);
    }
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** One iteration of the behaviour state machine. */
  async _tick() {
    if (!this.bot.entity) return;

    const snapshot = this.perception.scan(24);

    // Highest priority: survive (health/hunger/hazards) overrides everything.
    if (this.survival.isCritical() || snapshot.hostileMobs.length > 0) {
      this.state = snapshot.hostileMobs.length > 0 ? STATES.COMBAT : STATES.SURVIVE;
    } else if (this.inventory.isFull()) {
      this.state = STATES.BUILD; // route through storage handling
    } else {
      const task = this.goalPlanner.getNextTask();
      this.currentTask = task;
      this.state = this._taskToState(task);
    }

    console.log(`[AiSteve] State: ${this.state} | HP:${this.bot.health} Food:${this.bot.food}`);

    switch (this.state) {
      case STATES.COMBAT:
        await this.combat.handleHostiles(snapshot.hostileMobs);
        break;
      case STATES.SURVIVE:
        await this._handleSurvive(snapshot);
        break;
      case STATES.GATHER:
        await this._handleGather(this.currentTask);
        break;
      case STATES.CRAFT:
        await this._handleCraft(this.currentTask);
        break;
      case STATES.BUILD:
        await this._handleBuild(this.currentTask);
        break;
      case STATES.EXPLORE:
        await this._handleExplore();
        break;
      case STATES.IDLE:
      default:
        await this._sleep(500);
        break;
    }
  }

  _taskToState(task) {
    if (task.type === "GATHER") return STATES.GATHER;
    if (task.type === "BUILD") return STATES.BUILD;
    if (task.type === "MAINTAIN") return STATES.EXPLORE;
    return STATES.IDLE;
  }

  async _handleSurvive(snapshot) {
    await this.survival.eatIfHungry();
    await this.survival.avoidHazards();
    await this.survival.checkVitals();

    if (this.survival.shouldSeekShelter() && this.memory.hasBase()) {
      try {
        await this.navigation.goTo(this.memory.baseLocation, { range: 2, timeoutMs: 20000 });
      } catch (_) {
        // best effort
      }
    }
  }

  async _handleGather(task) {
    if (!task) return;
    let collected = 0;
    if (task.resource === "wood") {
      collected = await this.resources.gatherWood(task.amount);
    } else if (task.resource === "stone") {
      collected = await this.resources.gatherStone(task.amount);
    } else if (task.resource === "iron") {
      collected = await this.resources.gatherOre("iron", task.amount);
      // Smelt raw iron into ingots if we have coal.
      if (this.inventory.hasItem("raw_iron") && this.inventory.hasItem("coal")) {
        await this.crafting.smelt("raw_iron", this.inventory.countItem("raw_iron"));
      }
    }

    await this.resources.collectNearbyItems();

    if (collected === 0) {
      // Nothing found nearby; explore to find more resources.
      await this._handleExplore();
    } else if (task.then) {
      await this._handleCraft({ type: task.then });
    }
  }

  async _handleCraft(task) {
    if (!task) return;
    switch (task.type) {
      case "CRAFT_WOOD_TOOLS":
        await this.crafting.craftWoodenToolSet();
        break;
      case "CRAFT_STONE_TOOLS":
        await this.crafting.craftStoneToolSet();
        break;
      case "CRAFT_IRON_TOOLS":
        await this.crafting.craftIronToolSet();
        break;
      default:
        break;
    }
  }

  async _handleBuild(task) {
    if (this.inventory.isFull()) {
      const deposited = await this.storage.depositExcess();
      if (!deposited) await this.inventory.tossJunk();
      return;
    }

    if (!task) return;

    if (task.target === "shelter") {
      if (this.building.hasEnoughMaterials()) {
        await this.building.buildShelter();
      } else {
        await this.resources.gatherWood(8);
      }
    } else if (task.target === "storage") {
      if (this.inventory.hasItem("chest")) {
        await this.storage.placeChest();
      } else if (this.inventory.hasItem("oak_planks", 8) || this.inventory.hasItem("oak_log", 2)) {
        await this.crafting.craftItem("oak_planks", 8);
        await this.crafting.craftItem("chest", 1);
      } else {
        await this.resources.gatherWood(8);
      }
    }
  }

  async _handleExplore() {
    const pos = this.bot.entity.position;
    const angle = Math.random() * Math.PI * 2;
    const distance = 20;
    const targetX = Math.round(pos.x + Math.cos(angle) * distance);
    const targetZ = Math.round(pos.z + Math.sin(angle) * distance);

    try {
      await this.navigation.goToXZ(targetX, targetZ, 20000);
    } catch (_) {
      // exploration failures are non-fatal; we'll just try a different direction next tick
    }
  }

  stop() {
    this.running = false;
    this.navigation?.stop();
    this.bot?.quit();
  }
}

function main() {
  const steve = new AiSteve(config);
  steve.connect();

  process.on("SIGINT", () => {
    console.log("\n[AiSteve] Shutting down...");
    steve.stop();
    process.exit(0);
  });
}

if (require.main === module) {
  main();
}

module.exports = { AiSteve, STATES };
