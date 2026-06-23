// rewardSystem.js — Point-based learning layer
// Sits between events and learningSystem; computes scaled rewards
// and feeds them into decision weights.

const REWARDS = {
  CRAFT_SUCCESS:       5,
  TOOL_TIER_UPGRADE:  20,
  SHELTER_COMPLETED:  50,
  SURVIVED_NIGHT:     10,
  MOB_KILLED:          3,
  RESOURCE_GATHERED: 0.5,
  DEATH:             -30,
  FAILED_CRAFT:       -2,
  STUCK_RECOVERY:     -1,
  ITEM_LOST_DESPAWN:  -5,
};

class RewardSystem {
  constructor(learningSystem) {
    this.learning = learningSystem;
    this.weights  = {}; // "action:context" -> score
    this.episodeLog = []; // current life's events, for end-of-episode analysis
  }

  // Call this whenever something reward-worthy happens
  record(eventType, context, repeatCount) {
    repeatCount = repeatCount || 0;
    const base = REWARDS[eventType] ?? 0;
    const scaled = this._scale(base, repeatCount);

    this.episodeLog.push({ eventType, context, scaled, t: Date.now() });

    if (context) {
      this._updateWeight(eventType, context, scaled);
    }

    return scaled;
  }

  _scale(base, repeatCount) {
    if (base >= 0) return base; // only penalties scale with repetition
    const multiplier = Math.min(1 + repeatCount * 0.3, 3);
    return base * multiplier;
  }

  _updateWeight(action, context, reward) {
    const key = action + ':' + context;
    const old = this.weights[key] ?? 0;
    const lr  = 0.2; // learning rate
    this.weights[key] = old + lr * (reward - old);
  }

  getWeight(action, context) {
    return this.weights[(action + ':' + context)] ?? 0;
  }

  // Call at death/respawn to reset short-term episode tracking
  endEpisode() {
    const total = this.episodeLog.reduce((s, e) => s + e.scaled, 0);
    console.log('[Reward] Episode ended. Net score: ' + total.toFixed(1) +
      ' (' + this.episodeLog.length + ' events)');
    this.episodeLog = [];
    return total;
  }
}

module.exports = { RewardSystem, REWARDS };
