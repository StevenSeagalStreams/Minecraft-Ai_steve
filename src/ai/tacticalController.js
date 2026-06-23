"use strict";

const ACTIONS = require("./goap/actions");
const MODULE  = "Tactical";

/**
 * Tactical Controller: executes a single GOAP action by name.
 * Receives the full systems context and dispatches to the
 * appropriate subsystem.
 */
class TacticalController {
  constructor(systems, config, logger, eventBus) {
    this.systems   = systems;
    this.config    = config;
    this.logger    = logger;
    this.eventBus  = eventBus;
    this._actionMap = new Map(ACTIONS.map((a) => [a.name, a]));
    this._running   = false;
    this._currentAction = null;
  }

  get isRunning()     { return this._running; }
  get currentAction() { return this._currentAction; }

  async execute(actionName) {
    const action = this._actionMap.get(actionName);
    if (!action) {
      this.logger.warn(MODULE, `Unknown action: ${actionName}`);
      return false;
    }

    this._running       = true;
    this._currentAction = actionName;
    this.logger.info(MODULE, `Executing: ${actionName}`);

    // Build the context for action.execute()
    const ctx = {
      bot:        this.systems.bot,
      survival:   this.systems.survival,
      combat:     this.systems.combat,
      resources:  this.systems.resources,
      crafting:   this.systems.crafting,
      storage:    this.systems.storage,
      base:       this.systems.base,
      farming:    this.systems.farming,
      navigation: this.systems.navigation,
      inventory:  this.systems.inventory,
      perception: this.systems.perception,
      memory:     this.systems.memory,
      logger:     this.logger,
      config:     this.config,
    };

    try {
      await action.execute(ctx);
      this.logger.info(MODULE, `Finished: ${actionName}`);
      this.eventBus.emit("action:complete", { action: actionName });
      this._running = false;
      return true;
    } catch (err) {
      this.logger.error(MODULE, `Action ${actionName} failed: ${err.message}`);
      this.eventBus.emit("action:fail", { action: actionName, reason: err.message });
      this._running = false;
      return false;
    } finally {
      this._currentAction = null;
    }
  }
}

module.exports = TacticalController;
