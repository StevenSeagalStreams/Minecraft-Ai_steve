"use strict";

const { EventEmitter } = require("events");

/**
 * Central event bus decoupling all subsystems.
 *
 * Standard events emitted by subsystems:
 *   survival:critical   { health, cause }
 *   survival:hungry     { food }
 *   combat:start        { target }
 *   combat:end          { target, success }
 *   state:change        { from, to }
 *   goal:complete       { goal }
 *   goal:fail           { goal, reason }
 *   death:occurred      { position, items, cause }
 *   death:recovered     { itemsRecovered }
 *   resource:found      { type, position }
 *   base:built          { phase, position }
 *   inventory:full      {}
 *   tick:before         {}
 *   tick:after          { durationMs }
 */
class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(64);
    this._history = [];
    this._maxHistory = 500;
  }

  emit(event, data) {
    const record = { event, data, ts: Date.now() };
    this._history.push(record);
    if (this._history.length > this._maxHistory) this._history.shift();
    return super.emit(event, data);
  }

  recent(n = 10) {
    return this._history.slice(-n);
  }

  /** Filters history for events of a specific type. */
  recentOf(event, n = 5) {
    return this._history.filter((e) => e.event === event).slice(-n);
  }
}

module.exports = new EventBus(); // singleton
