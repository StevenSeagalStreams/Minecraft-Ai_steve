const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const config = require('./config');

class Navigation {
  constructor(bot, memory) {
    this.bot           = bot;
    this.memory        = memory;
    this._lastPos      = null;
    this._lastPosTime  = Date.now();
    this._stuckCount   = 0;
    this._stuckTotal   = 0; // total consecutive stuck recoveries
    this._exploreAngle = Math.random() * Math.PI * 2;
    this.bot.setMaxListeners(50);
    this._setupPathfinder();
    console.log('[Navigation] Initialised');
  }

  _setupPathfinder() {
    this.bot.loadPlugin(pathfinder);
    const mcData = require('minecraft-data')(this.bot.version);
    this.movements = new Movements(this.bot, mcData);
    this.movements.allowSprinting = true;
    this.movements.allowParkour   = true;
    this.movements.canDig         = true;
    this.movements.maxDropDown    = 3;
    this.bot.pathfinder.setMovements(this.movements);
  }

  async moveTo(pos, tolerance) {
    tolerance = tolerance || 1;
    return this._executeGoal(new goals.GoalNear(pos.x, pos.y, pos.z, tolerance), pos);
  }

  async moveToEntity(entity, range) {
    range = range || 2;
    return this._executeGoal(new goals.GoalFollow(entity, range), entity.position);
  }

  async moveToBlock(blockPos) {
    return this._executeGoal(new goals.GoalGetToBlock(blockPos.x, blockPos.y, blockPos.z), blockPos);
  }

  async _executeGoal(goal, targetHint, timeout) {
    timeout = timeout || 20000;
    this.bot.pathfinder.setGoal(null);
    await this._sleep(50);
    return new Promise((resolve) => {
      let resolved = false;
      const done = (result) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        this.bot.removeListener('goal_reached', onGoal);
        this.bot.removeListener('path_update', onPathUpdate);
        resolve(result);
      };
      const timer = setTimeout(() => {
        this.bot.pathfinder.setGoal(null);
        console.warn('[Navigation] Movement timeout');
        if (targetHint) this.memory.blacklistPosition(targetHint);
        done(false);
      }, timeout);
      const onGoal = () => done(true);
      const onPathUpdate = (r) => {
        if (r.status === 'noPath') {
          console.warn('[Navigation] No path found');
          done(false);
        }
      };
      this.bot.once('goal_reached', onGoal);
      this.bot.once('path_update', onPathUpdate);
      try { this.bot.pathfinder.setGoal(goal); }
      catch(e) { done(false); }
    });
  }

  async exploreStep(stepDistance) {
    stepDistance = stepDistance || config.stateMachine.exploreStepDistance;
    this._exploreAngle += 0.35;
    const pos  = this.bot.entity.position;
    const dest = new Vec3(
      Math.floor(pos.x + Math.cos(this._exploreAngle) * stepDistance),
      pos.y,
      Math.floor(pos.z + Math.sin(this._exploreAngle) * stepDistance),
    );
    if (this.memory.isBlacklisted(dest) || this.memory.isDangerous(dest)) {
      this._exploreAngle += Math.PI / 4;
      return false;
    }
    console.log('[Navigation] Exploring toward ' + dest.x + ', ' + dest.y + ', ' + dest.z);
    const success = await this.moveTo(dest, 3);
    this.memory.markExplored(pos);
    return success;
  }

  async fleeFrom(dangerPos, distance) {
    distance = distance || 20;
    const botPos = this.bot.entity.position;
    const dir    = botPos.minus(dangerPos).normalize();
    const target = botPos.offset(dir.x * distance, 0, dir.z * distance);
    console.log('[Navigation] Fleeing...');
    return this.moveTo(target, 2);
  }

  isStuck() {
    const now    = Date.now();
    const curPos = this.bot.entity.position;
    if (!this._lastPos) {
      this._lastPos = curPos.clone(); this._lastPosTime = now; return false;
    }
    if (now - this._lastPosTime < config.navigation.stuckTimeout) return false;
    const moved = curPos.distanceTo(this._lastPos);
    this._lastPos = curPos.clone(); this._lastPosTime = now;
    if (moved < config.navigation.stuckDistance) {
      this._stuckCount++;
      console.warn('[Navigation] Possibly stuck (moved ' + moved.toFixed(2) + '). Count: ' + this._stuckCount);
      return this._stuckCount >= 2;
    }
    this._stuckCount = 0;
    this._stuckTotal = 0;
    this._stuckCycles = 0;
    return false;
  }

  async recoverFromStuck() {
    console.log('[Navigation] Recovering from stuck...');
    this._stuckCount = 0;
    this._stuckTotal++;
    this._stuckCycles = (this._stuckCycles || 0) + 1;
    this.bot.pathfinder.setGoal(null);
    this.bot.clearControlStates();
    await this._sleep(300);

    const pos = this.bot.entity.position.floored();

    // Absolute last resort — if we've gone through many full recovery
    // cycles (brute-force escapes included) with zero successful moves,
    // the bot is almost certainly wedged somewhere with no reachable
    // open block in any direction (e.g. encased after a respawn glitch
    // or buried by terrain). Rather than freezing forever, deliberately
    // take fatal damage to force a fresh respawn elsewhere.
    if (this._stuckCycles > 20) {
      console.error('[Navigation] Wedged with no escape after ' + this._stuckCycles +
        ' recovery cycles — forcing respawn via self-damage');
      this._stuckCycles = 0;
      try {
        // Suffocation/void damage isn't directly triggerable, but
        // repeatedly digging straight down can drop the bot into the
        // void or lava if any exists below, and starves out any
        // remaining stuck loop by changing position entirely.
        for (let dy = 0; dy <= 3; dy++) {
          const b = this.bot.blockAt(pos.offset(0, -dy, 0));
          if (b && b.boundingBox === 'block' && !['bedrock'].includes(b.name)) {
            try { await this.bot.dig(b, true); } catch(e) {}
          }
        }
      } catch(e) {}
      return;
    }

    // After many failed recoveries — blacklist area and teleport-style escape
    if (this._stuckTotal > 6) {
      console.warn('[Navigation] Repeatedly stuck — blacklisting position and escaping');
      this.memory.blacklistPosition(pos);
      this._stuckTotal = 0;
      await this._bruteForceEscape();
      return;
    }

    // Try to dig out if surrounded — but skip if we're just next to stone
    // we're intentionally mining (3+ solid sides AND can't move at all is the
    // real "trapped" case; 2 sides next to a rock face is normal mining).
    const solidAround = this._countSolidNeighbors(pos);
    if (solidAround >= 3) {
      console.log('[Navigation] Surrounded by blocks — digging out');
      await this._digAround(pos);
      await this._sleep(500);
    }

    // Jump and move in a random direction
    const angle = (this._stuckTotal * 1.3) % (Math.PI * 2);
    this.bot.entity.yaw = angle;

    for (let i = 0; i < 5; i++) {
      this.bot.setControlState('jump', true);
      this.bot.setControlState('forward', true);
      this.bot.setControlState('sprint', true);
      await this._sleep(250);
    }
    this.bot.clearControlStates();

    // Try to move to a nearby open position
    for (const [dx, dz] of [[8,0],[-8,0],[0,8],[0,-8],[8,8],[-8,-8],[8,-8],[-8,8]]) {
      const target = pos.offset(dx, 0, dz);
      const ok = await this.moveTo(target, 2);
      if (ok) {
        this._stuckTotal = 0;
        return;
      }
    }
  }

  _countSolidNeighbors(pos) {
    let count = 0;
    // Check both floor-level AND head-level (pos+1) neighbors — a block
    // at head height is just as trapping as one at foot height, and the
    // old version only checked foot level, missing the real obstruction.
    const checks = [
      pos.offset(1,0,0),  pos.offset(-1,0,0),
      pos.offset(0,0,1),  pos.offset(0,0,-1),
      pos.offset(1,1,0),  pos.offset(-1,1,0),
      pos.offset(0,1,1),  pos.offset(0,1,-1),
      pos.offset(0,-1,0), // floor
    ];
    for (const p of checks) {
      const b = this.bot.blockAt(p);
      if (b && b.boundingBox === 'block') count++;
    }
    return count;
  }

  async _digAround(pos) {
    // Dig the blocks immediately around the bot at BOTH foot and head
    // height, plus directly above — a single un-dug head-height block
    // is enough to keep him stuck even after foot-level is cleared.
    const targets = [
      pos.offset(1,0,0),  pos.offset(-1,0,0),
      pos.offset(0,0,1),  pos.offset(0,0,-1),
      pos.offset(1,1,0),  pos.offset(-1,1,0),
      pos.offset(0,1,1),  pos.offset(0,1,-1),
      pos.offset(0,1,0),  pos.offset(0,2,0), // straight above, two high
    ];
    for (const tp of targets) {
      const block = this.bot.blockAt(tp);
      if (!block || block.boundingBox !== 'block') continue;
      if (['bedrock','lava','flowing_lava','water'].includes(block.name)) continue;
      try {
        await this.bot.lookAt(tp.offset(0.5,0.5,0.5));
        // Try to dig with or without correct tool
        await this.bot.dig(block, true);
        await this._sleep(100);
      } catch(e) {}
    }
  }

  async _bruteForceEscape() {
    console.log('[Navigation] Brute force escape...');
    // Dig upward
    const pos = this.bot.entity.position.floored();
    for (let dy = 1; dy <= 6; dy++) {
      const block = this.bot.blockAt(pos.offset(0, dy, 0));
      if (!block || block.name === 'air') break;
      if (['bedrock','lava'].includes(block.name)) break;
      try { await this.bot.dig(block, true); await this._sleep(100); } catch(e) {}
    }
    // Sprint in random direction for 3 seconds
    const randomYaw = Math.random() * Math.PI * 2;
    this.bot.entity.yaw = randomYaw;
    this.bot.setControlState('sprint', true);
    this.bot.setControlState('forward', true);
    this.bot.setControlState('jump', true);
    await this._sleep(3000);
    this.bot.clearControlStates();
  }

  async lookAt(pos) { await this.bot.lookAt(pos, true); }

  /** Call this right after respawn — avoids comparing the fresh spawn
   *  position against stale pre-death coordinates, which could trigger
   *  a false "stuck" detection on the very first check after dying. */
  resetPositionTracking() {
    this._lastPos = null;
    this._lastPosTime = Date.now();
    this._stuckCount = 0;
    this._stuckTotal = 0;
    this._stuckCycles = 0;
  }

  stop() {
    this.bot.pathfinder.setGoal(null);
    this.bot.clearControlStates();
  }

  distanceTo(pos)   { return this.bot.entity.position.distanceTo(pos); }
  currentPosition() { return this.bot.entity.position.clone(); }
  _sleep(ms)        { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = Navigation;
