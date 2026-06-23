"use strict";

/**
 * Behaviour Tree node types.
 *
 * Status codes:
 *   SUCCESS  - node completed successfully
 *   FAILURE  - node failed
 *   RUNNING  - node is still in progress
 */

const SUCCESS = "SUCCESS";
const FAILURE = "FAILURE";
const RUNNING = "RUNNING";

// ─── Base ─────────────────────────────────────────────────────────────────────

class BTNode {
  constructor(name) { this.name = name; }
  async tick(ctx) { throw new Error(`${this.name}: tick() not implemented`); }
}

// ─── Composites ───────────────────────────────────────────────────────────────

/** Runs children in order; stops and returns FAILURE if any child fails. */
class Sequence extends BTNode {
  constructor(name, children) {
    super(name);
    this.children = children;
  }
  async tick(ctx) {
    for (const child of this.children) {
      const result = await child.tick(ctx);
      if (result !== SUCCESS) return result;
    }
    return SUCCESS;
  }
}

/** Runs children in order; stops and returns SUCCESS if any child succeeds. */
class Selector extends BTNode {
  constructor(name, children) {
    super(name);
    this.children = children;
  }
  async tick(ctx) {
    for (const child of this.children) {
      const result = await child.tick(ctx);
      if (result !== FAILURE) return result;
    }
    return FAILURE;
  }
}

/** Runs all children in order regardless of results; returns SUCCESS always. */
class Parallel extends BTNode {
  constructor(name, children, successThreshold) {
    super(name);
    this.children = children;
    this.successThreshold = successThreshold ?? children.length;
  }
  async tick(ctx) {
    let successes = 0;
    for (const child of this.children) {
      const result = await child.tick(ctx);
      if (result === SUCCESS) successes++;
    }
    return successes >= this.successThreshold ? SUCCESS : FAILURE;
  }
}

// ─── Decorators ───────────────────────────────────────────────────────────────

/** Inverts the child's result. */
class Inverter extends BTNode {
  constructor(child) {
    super(`NOT(${child.name})`);
    this.child = child;
  }
  async tick(ctx) {
    const r = await this.child.tick(ctx);
    if (r === SUCCESS) return FAILURE;
    if (r === FAILURE) return SUCCESS;
    return r;
  }
}

/** Returns SUCCESS regardless of child's result. */
class AlwaysSucceed extends BTNode {
  constructor(child) {
    super(`AlwaysSucceed(${child.name})`);
    this.child = child;
  }
  async tick(ctx) { await this.child.tick(ctx); return SUCCESS; }
}

/** Only ticks child if condition() returns true. */
class Condition extends BTNode {
  constructor(name, condFn) {
    super(name);
    this.condFn = condFn;
  }
  async tick(ctx) { return (await this.condFn(ctx)) ? SUCCESS : FAILURE; }
}

/** Leaf node that calls an async action function. */
class Action extends BTNode {
  constructor(name, actionFn) {
    super(name);
    this.actionFn = actionFn;
  }
  async tick(ctx) {
    try {
      const result = await this.actionFn(ctx);
      return result === false ? FAILURE : SUCCESS;
    } catch (err) {
      ctx.logger?.warn("BT:Action", `${this.name} threw: ${err.message}`);
      return FAILURE;
    }
  }
}

/** Repeats child until it succeeds or maxTries exhausted. */
class Retry extends BTNode {
  constructor(name, child, maxTries = 3) {
    super(name);
    this.child    = child;
    this.maxTries = maxTries;
  }
  async tick(ctx) {
    for (let i = 0; i < this.maxTries; i++) {
      const r = await this.child.tick(ctx);
      if (r === SUCCESS) return SUCCESS;
    }
    return FAILURE;
  }
}

module.exports = {
  SUCCESS, FAILURE, RUNNING,
  BTNode, Sequence, Selector, Parallel, Inverter, AlwaysSucceed, Condition, Action, Retry,
};
