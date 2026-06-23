"use strict";

/**
 * AI Steve — Main Entry Point
 *
 * Wires up every subsystem and runs the three-layer autonomous loop:
 *
 *   Layer 1 (every tick):   SurvivalManager   — health, hunger, hazards
 *   Layer 2 (every tick):   BehaviourTree     — tactical decisions
 *   Layer 3 (each plan):    GOAP Planner via StrategicPlanner + TacticalController
 *
 * The bot will never proceed past layer 1 if survival is threatened.
 */

const mineflayer = require("mineflayer");
const path       = require("path");

// ── Infrastructure ────────────────────────────────────────────────────────────
const config   = require("../config");
const Logger   = require("./core/logger");
const eventBus = require("./core/eventBus");

// ── Memory + Perception ───────────────────────────────────────────────────────
const MemorySystem = require("./memory/memorySystem");
const { Perception } = require("./perception/perception");

// ── Systems ───────────────────────────────────────────────────────────────────
const Navigation       = require("./systems/navigation");
const InventoryManager = require("./systems/inventoryManager");
const CraftingSystem   = require("./systems/craftingSystem");
const ResourceManager  = require("./systems/resourceManager");
const CombatSystem     = require("./systems/combatSystem");
const StorageSystem    = require("./systems/storageSystem");
const BaseManager      = require("./systems/baseManager");
const FarmingSystem    = require("./systems/farmingSystem");
const DeathRecovery    = require("./systems/deathRecovery");

// ── AI ────────────────────────────────────────────────────────────────────────
const SurvivalManager    = require("./ai/survivalManager");
const RiskAssessor       = require("./ai/riskAssessor");
const StrategicPlanner   = require("./ai/strategicPlanner");
const TacticalController = require("./ai/tacticalController");
const { buildSurvivalTree, buildTacticalTree } = require("./ai/behaviorTree/trees");
const { capture }          = require("./ai/goap/worldState");
const { ProgressionTracker } = require("./progression/progressionTracker");

// FSM states
const STATES = {
  BOOTING:    "BOOTING",
  SURVIVAL:   "SURVIVAL",
  RECOVERING: "RECOVERING",
  TACTICAL:   "TACTICAL",
  PLANNING:   "PLANNING",
};

class AiSteve {
  constructor() {
    this.logger    = new Logger(config);
    this.state     = STATES.BOOTING;
    this.bot       = null;
    this.systems   = {};
    this._running  = false;
    this._tickCount = 0;
    this._lastPerceptionTime = 0;
    this._lastSaveTime = 0;
    this._survived = false;
    this._hasDied  = false;
  }

  // ─── Connect ──────────────────────────────────────────────────────────────

  connect() {
    this.logger.info("Main", `Connecting to ${config.host}:${config.port} as ${config.username}`);
    this.bot = mineflayer.createBot({
      host:     config.host,
      port:     config.port,
      username: config.username,
      password: config.password,
      auth:     config.auth,
      version:  config.version,
    });

    this.bot.once("spawn",   ()        => this._onSpawn());
    this.bot.on("kicked",    (reason)  => this.logger.error("Main", "Kicked", { reason }));
    this.bot.on("error",     (err)     => this.logger.error("Main", "Error", { msg: err.message }));
    this.bot.on("death",     ()        => this._onDeath());
    this.bot.on("end",       ()        => this._onDisconnect());
    this.bot.on("physicsTick", ()      => this._quickTick());
  }

  // ─── Spawn ────────────────────────────────────────────────────────────────

  _onSpawn() {
    this.logger.info("Main", "Spawned — initialising subsystems");

    // Infrastructure
    const memory = new MemorySystem(config, this.logger);
    const perception = new Perception(this.bot, this.logger);

    // Systems
    const navigation = new Navigation(this.bot, config, this.logger, eventBus);
    const inventory  = new InventoryManager(this.bot, config, this.logger);
    const crafting   = new CraftingSystem(this.bot, navigation, inventory, memory, this.logger, eventBus);
    const resources  = new ResourceManager(this.bot, perception, navigation, inventory, memory, this.logger, eventBus);
    const combat     = new CombatSystem(this.bot, perception, navigation, inventory, memory, this.logger, config, eventBus);
    const storage    = new StorageSystem(this.bot, navigation, inventory, memory, crafting, this.logger, eventBus);
    const base       = new BaseManager(this.bot, navigation, inventory, crafting, storage, memory, this.logger, eventBus, config);
    const farming    = new FarmingSystem(this.bot, navigation, inventory, crafting, memory, this.logger);
    const survival   = new SurvivalManager(this.bot, perception, navigation, inventory, memory, config, this.logger, eventBus);

    // Death recovery (auto-hooks bot death event)
    const recovery   = new DeathRecovery(this.bot, perception, navigation, inventory, crafting, storage, memory, this.logger, config, eventBus);

    // AI
    const risk       = new RiskAssessor(config, this.logger);
    const progression = new ProgressionTracker(inventory, memory, this.logger);
    const strategic  = new StrategicPlanner({ bot: this.bot, ...this._sysMap() }, config, this.logger, eventBus);
    const tactical   = new TacticalController({ bot: this.bot, survival, combat, resources, crafting, storage, base, farming, navigation, inventory, perception, memory }, config, this.logger, eventBus);

    // Behaviour trees
    const survivalTree = buildSurvivalTree();
    const tacticalTree = buildTacticalTree();

    this.systems = {
      memory, perception, navigation, inventory, crafting,
      resources, combat, storage, base, farming, survival, recovery,
      risk, progression, strategic, tactical, survivalTree, tacticalTree,
    };

    // Event listeners
    this._attachEventListeners();

    // Begin main loop
    this._running  = true;
    this.state     = STATES.SURVIVAL;
    this._mainLoop();
  }

  _sysMap() {
    // Placeholder — real map provided after systems are built
    return {};
  }

  // ─── Event listeners ──────────────────────────────────────────────────────

  _attachEventListeners() {
    const { memory, logger } = this.systems;

    eventBus.on("death:occurred", ({ position, items }) => {
      logger.warn("Main", `Death at ${JSON.stringify(position)}`);
      this._hasDied = true;
      this.state = STATES.RECOVERING;
    });

    eventBus.on("base:built", ({ phase }) => {
      logger.info("Main", `Base phase ${phase} established`);
    });

    eventBus.on("combat:start", ({ target }) => {
      logger.info("Main", `Combat: engaging ${target}`);
    });

    eventBus.on("combat:end", ({ target, success }) => {
      if (success) memory.increment("mobsKilled");
    });

    // Periodic stats emit
    setInterval(() => {
      this.logger.telemetry("stats", {
        health:     this.bot?.health,
        food:       this.bot?.food,
        pos:        this.bot?.entity?.position,
        state:      this.state,
        stage:      this.systems.progression?.currentStage()?.name,
        stats:      this.systems.memory?.stats,
        logCounts:  this.logger.stats(),
      });
    }, 30000);
  }

  // ─── Quick per-physics-tick checks ────────────────────────────────────────
  // (keeps the bot from taking damage while the main async loop is mid-task)

  _quickTick() {
    if (!this._running || !this.bot.entity) return;
    // Auto-sprint unless we're in combat and need precise control
    this.bot.setControlState("sprint", !this.systems.combat?.inCombat);
  }

  // ─── Main async loop ──────────────────────────────────────────────────────

  async _mainLoop() {
    while (this._running) {
      const tickStart = Date.now();
      try {
        await this._tick();
      } catch (err) {
        this.logger.error("Main", `Tick error: ${err.message}`);
      }
      const elapsed = Date.now() - tickStart;
      const wait    = Math.max(0, config.tickIntervalMs - elapsed);
      await this._sleep(wait);
    }
  }

  async _tick() {
    this._tickCount++;
    const { perception, survival, combat, strategic, tactical, progression, risk,
            survivalTree, tacticalTree, memory, navigation, recovery } = this.systems;

    // Refresh perception on schedule
    const now = Date.now();
    if (now - this._lastPerceptionTime >= config.perceptionIntervalMs) {
      perception.scan(32);
      this._lastPerceptionTime = now;
    }

    // Auto-save memory
    if (now - this._lastSaveTime >= config.saveInterval) {
      memory.save();
      this._lastSaveTime = now;
    }

    const snap = perception.last;
    if (!snap) return;

    // ── FSM ──────────────────────────────────────────────────────────────

    // RECOVERING: post-death recovery takes priority until complete
    if (this.state === STATES.RECOVERING) {
      this.logger.info("Main", "State: RECOVERING");
      const ok = await recovery.recover();
      this.state = STATES.SURVIVAL;
      this._hasDied = false;
      strategic.reset();
      return;
    }

    // Build survival context for behaviour tree
    const btCtx = {
      bot:        this.bot,
      config,
      survival,
      combat,
      navigation,
      perception,
      memory,
      base:       this.systems.base,
      farming:    this.systems.farming,
      inventory:  this.systems.inventory,
      resources:  this.systems.resources,
      crafting:   this.systems.crafting,
      storage:    this.systems.storage,
      logger:     this.logger,
    };

    // ── Layer 1: Survival (always runs) ──────────────────────────────────
    await survival.checkVitals();
    await survival.avoidHazards();

    const survResult = await survivalTree.tick(btCtx);
    if (survResult === "FAILURE") {
      this.logger.warn("Main", "Survival tree returned FAILURE — idling");
      return;
    }

    // Abort tactical work if risk too high
    const botStats = {
      health:   this.bot.health,
      food:     this.bot.food,
      hasArmor: this.systems.inventory.has("iron_chestplate") || this.systems.inventory.has("diamond_chestplate"),
      hasSword: !!this.systems.inventory.getBestTool("sword"),
    };
    if (risk.shouldAbort(snap, botStats)) {
      this.logger.warn("Main", `Risk ${risk.assess(snap,botStats).toFixed(2)} — aborting tactical work`);
      navigation.stop();
      return;
    }

    // ── Layer 2: Tactical Behaviour Tree ─────────────────────────────────
    this.state = STATES.TACTICAL;
    await tacticalTree.tick(btCtx);

    // ── Layer 3: GOAP Strategic Planner ──────────────────────────────────
    // Only runs strategic planning once per 5 ticks to avoid overhead.
    if (this._tickCount % 5 === 0) {
      this.state = STATES.PLANNING;
      const worldState = capture(this.bot, this.systems.inventory, memory, perception, this.systems.base);
      const actionName  = strategic.nextAction(worldState, progression);

      if (actionName && !tactical.isRunning) {
        const success = await tactical.execute(actionName);
        if (success) {
          strategic.advance();
          memory.recordSuccess(actionName);
        } else {
          memory.recordFailure(actionName);
          strategic.reset();
        }
      }
    }

    // ── Logging ──────────────────────────────────────────────────────────
    if (this._tickCount % 20 === 0) {
      const prog  = progression.summary(snap);
      this.logger.info("Main",
        `Tick:${this._tickCount} HP:${this.bot.health} Food:${this.bot.food} ` +
        `Stage:[${prog.currentStage}] Action:[${tactical.currentAction ?? "idle"}] ` +
        `Mobs:${snap.hostileMobs.length} Night:${snap.isNight}`
      );
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  _onDeath() {
    this.logger.warn("Main", "Bot died");
    this.systems.memory?.increment("deaths");
    this.state = STATES.RECOVERING;
  }

  _onDisconnect() {
    this.logger.info("Main", "Disconnected — saving memory");
    this.systems.memory?.save();
    this._running = false;
  }

  stop() {
    this.logger.info("Main", "Shutting down");
    this._running = false;
    this.systems.navigation?.stop();
    this.systems.memory?.save();
    this.logger.close();
    this.bot?.quit();
  }

  _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

if (require.main === module) {
  const steve = new AiSteve();
  steve.connect();

  process.on("SIGINT", () => {
    console.log("\nSIGINT — shutting down gracefully");
    steve.stop();
    process.exit(0);
  });
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    steve.stop();
    process.exit(1);
  });
}

module.exports = AiSteve;
