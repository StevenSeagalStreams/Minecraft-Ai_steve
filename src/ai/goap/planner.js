"use strict";

const { WorldState } = require("./worldState");

/**
 * A* GOAP Planner.
 *
 * Searches for the lowest-cost sequence of actions that transforms
 * currentState into a state satisfying goalState.
 *
 * Nodes in the search graph are (WorldState, actionsTaken[], cost).
 * Heuristic: number of unmet goal keys.
 */
class GOAPPlanner {
  constructor(actions, config, logger) {
    this.actions = actions;
    this.config  = config;
    this.logger  = logger;
  }

  /**
   * Returns an ordered array of action names forming the cheapest plan,
   * or null if no plan was found within maxDepth.
   */
  plan(currentState, goalState, maxDepth = this.config.goap.maxPlanDepth) {
    const start = Date.now();

    // Open list: priority queue sorted by f = g + h
    const open    = [];
    const visited = new Map(); // stateKey → bestCost

    open.push({ state: currentState.clone(), actions: [], g: 0 });

    while (open.length > 0) {
      if (Date.now() - start > this.config.goap.planTimeoutMs) {
        this.logger.warn("GOAP", "Plan timeout");
        break;
      }

      // Sort by f = g + h (greedy for speed; convert to proper priority queue if needed)
      open.sort((a, b) => (a.g + _heuristic(a.state, goalState)) - (b.g + _heuristic(b.state, goalState)));
      const node = open.shift();

      if (node.state.matches(goalState)) {
        this.logger.debug("GOAP", `Plan found (${node.actions.length} actions, cost=${node.g})`);
        return node.actions;
      }

      if (node.actions.length >= maxDepth) continue;

      const key = _stateKey(node.state, goalState);
      if (visited.has(key) && visited.get(key) <= node.g) continue;
      visited.set(key, node.g);

      for (const action of this.actions) {
        const pre = new WorldState(action.preconditions);
        if (!node.state.matches(pre)) continue;

        const nextState = node.state.clone();
        for (const [k, v] of Object.entries(action.effects)) nextState.set(k, v);

        open.push({
          state:   nextState,
          actions: [...node.actions, action.name],
          g:       node.g + action.cost,
        });
      }
    }

    this.logger.debug("GOAP", "No plan found for goal", goalState.toJSON());
    return null;
  }
}

function _heuristic(state, goal) {
  let unmet = 0;
  for (const [k, v] of Object.entries(goal.toJSON())) {
    if (state.get(k) !== v) unmet++;
  }
  return unmet * 2;
}

function _stateKey(state, goal) {
  // Only encode the keys that matter for the goal (reduces explosion)
  const relevant = Object.keys(goal.toJSON());
  return relevant.map((k) => `${k}:${state.get(k)}`).join("|");
}

module.exports = GOAPPlanner;
