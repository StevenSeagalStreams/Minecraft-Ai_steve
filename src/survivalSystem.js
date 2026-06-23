// survivalSystem.js
const config = require('./config');

class SurvivalSystem {
  constructor(bot, perception, inventory, navigation, memory) {
    this.bot        = bot;
    this.perception = perception;
    this.inventory  = inventory;
    this.navigation = navigation;
    this.memory     = memory;
    this.combat     = null; // wired in via setCombat() after CombatSystem exists

    this._eating    = false;
    this._inDanger  = false;
    this._deathPos  = null;
    this._deathTime = null;
    this._retrievalAttempts = 0;
    this.ITEM_DESPAWN_MS = 4 * 60 * 1000; // 4 min (items despawn at 5)

    this._registerHooks();
    console.log('[Survival] System initialised');
  }

  _registerHooks() {
    this.bot.on('health', async () => {
      if (this.bot.food <= config.survival.criticalHungerThreshold && !this._eating) {
        await this.eat();
      }
    });

    this.bot.on('death', () => {
      // Save death position BEFORE respawn (position changes on respawn)
      const deathX = Math.floor(this.bot.entity.position.x);
      const deathY = Math.floor(this.bot.entity.position.y);
      const deathZ = Math.floor(this.bot.entity.position.z);
      this._deathPos  = this.bot.entity.position.clone();
      this._deathTime = Date.now();
      console.log('[Survival] Died at ' + deathX + ',' + deathY + ',' + deathZ + ' — will retrieve items');
      this.bot.respawn();
    });

    // Log inventory after respawn so we know what survived, and
    // immediately check for danger right at the new spawn point —
    // without this, a hostile mob standing on/near the respawn point
    // can kill the bot again before the normal tick loop ever runs,
    // causing rapid chained deaths with no time to react.
    this.bot.on('spawn', () => {
      // Avoid comparing the new spawn position to stale pre-death
      // coordinates, which could falsely flag "stuck" on the very
      // first check after respawning somewhere completely different.
      if (this.navigation.resetPositionTracking) {
        this.navigation.resetPositionTracking();
      }

      setTimeout(() => {
        const items = this.bot.inventory.items();
        if (items.length === 0) {
          console.log('[Survival] Respawned with empty inventory — starting over');
        } else {
          const summary = items.map(i => i.name + ':' + i.count).join(', ');
          console.log('[Survival] Respawned with: ' + summary);
        }
      }, 500);

      // Fire-and-forget immediate safety sweep right after respawn
      this._immediateSpawnSafetyCheck().catch(() => {});
    });

    this.bot.on('physicsTick', () => {
      if (this.perception.isInLava()) this._escapeLava();
      this._checkDrowning();
    });
  }

  // ── drowning ──────────────────────────────────────────────

  _checkDrowning() {
    // bot.oxygenLevel is 0-20 (not 0-300 as previously assumed — that bug
    // made lowAir true almost constantly). isInWater is the reliable signal
    // for "currently submerged"; oxygenLevel tells us if it's actually urgent.
    const air = this.bot.oxygenLevel;
    const inWater = this.bot.entity.isInWater;
    const lowAir = air !== undefined && air <= 6; // out of 20 — genuinely low

    // Only treat this as an emergency if we're actually low on air while in water.
    // Being in water with full air (e.g. swimming normally) is not drowning.
    const isDrowningNow = inWater && lowAir;

    if (!isDrowningNow) {
      if (this._drowning) {
        this.bot.setControlState('jump', false);
        this.bot.setControlState('forward', false);
        this._drowning = false;
      }
      this._drownRetryCount = 0; // genuine success — actually surfaced
      return;
    }

    // Already actively handling this drowning episode — don't restart it
    if (this._drowning) return;

    this._drowning = true;
    this._drownRetryCount = (this._drownRetryCount || 0) + 1;

    // Throttle logging so repeated submerge/resurface cycles don't spam
    const now = Date.now();
    if (!this._lastDrownLog || now - this._lastDrownLog > 3000) {
      console.warn('[Survival] Drowning — surfacing! (attempt ' + this._drownRetryCount + ')');
      this._lastDrownLog = now;
    }

    // After repeated failed surfacing attempts, assume we're trapped in a
    // flooded enclosure and dig straight up instead of just swimming.
    // IMPORTANT: do not reset _drownRetryCount anywhere below this point
    // except on genuine surfacing (handled above) — it previously got
    // wiped by the timeout/interval callbacks every ~4s, which meant the
    // count could never climb past a handful of "attempt 1"s and digging
    // never actually triggered despite being stuck for a full minute.
    if (this._drownRetryCount > 4) {
      this._drowning = false; // let the next tick re-enter and call dig fresh
      this._digUpOutOfWater();
      return;
    }

    this.bot.setControlState('jump', true);
    this.bot.setControlState('forward', true);

    const clear = setInterval(() => {
      const stillDrowning = this.bot.entity.isInWater &&
        this.bot.oxygenLevel !== undefined && this.bot.oxygenLevel <= 8;
      if (!stillDrowning) {
        this.bot.setControlState('jump', false);
        this.bot.setControlState('forward', false);
        this._drowning = false;
        // Do NOT reset _drownRetryCount here — only a genuine non-drowning
        // tick (top of this function) should clear it. If we briefly
        // poke above the water line but sink right back down, the
        // attempt count needs to keep climbing toward the dig threshold.
        clearInterval(clear);
      }
    }, 500);

    setTimeout(() => {
      if (this._drowning) {
        this.bot.setControlState('jump', false);
        this.bot.setControlState('forward', false);
        this._drowning = false;
        // Same reasoning — don't reset the counter on a bare timeout.
        clearInterval(clear);
      }
    }, 4000);
  }

  async _digUpOutOfWater() {
    console.warn('[Survival] Trapped underwater — digging straight up');
    try {
      const pos = this.bot.entity.position.floored();
      for (let dy = 1; dy <= 10; dy++) {
        const block = this.bot.blockAt(pos.offset(0, dy, 0));
        if (!block) break;
        if (block.name === 'air') break; // breached open air, stop digging
        if (['bedrock'].includes(block.name)) break;
        try { await this.bot.dig(block, true); } catch(e) {}
      }
    } finally {
      this.bot.setControlState('jump', true);
      setTimeout(() => {
        this.bot.setControlState('jump', false);
        this.bot.setControlState('forward', false);
        this._drowning = false;
        // Only partially reduce the counter instead of zeroing it — if
        // one dig pass didn't reach air (e.g. a deep underwater ravine),
        // the next physicsTick should escalate to digging again almost
        // immediately rather than waiting through 5 more swim attempts.
        this._drownRetryCount = Math.max(0, (this._drownRetryCount || 0) - 1);
      }, 1500);
    }
  }

  // ── death retrieval ───────────────────────────────────────

  hasPendingDeathRetrieval() {
    if (!this._deathPos || !this._deathTime) return false;
    // Give up if items have despawned
    if (Date.now() - this._deathTime > this.ITEM_DESPAWN_MS) {
      console.log('[Survival] Items despawned — giving up retrieval');
      this._deathPos  = null;
      this._deathTime = null;
      return false;
    }
    return true;
  }

  setCombat(combat) { this.combat = combat; }
  setLearning(learning) { this.learning = learning; }

  /**
   * Runs immediately on the 'spawn' event, before the next normal tick.
   * This exists because rapid chained deaths were happening when a
   * hostile mob was right at/near the respawn point — by the time the
   * normal tick loop got around to checking threats, the bot was
   * already dead again. This gives an immediate first reaction.
   */
  async _immediateSpawnSafetyCheck() {
    await this._sleep(200); // let position/entities populate after spawn
    if (!this.bot.entity) return;

    // If we've died repeatedly near this exact spot recently, the
    // respawn point itself is hazardous (mob spawner, water, etc).
    // Sprint far away in a random direction immediately rather than
    // doing anything else — staying here is how the death chain keeps
    // happening.
    if (this.learning && this.learning.isInDeathCluster()) {
      console.warn('[Survival] Repeated deaths near this spot — sprinting away immediately');
      const angle = Math.random() * Math.PI * 2;
      this.bot.entity.yaw = angle;
      this.bot.setControlState('sprint', true);
      this.bot.setControlState('forward', true);
      this.bot.setControlState('jump', true);
      await this._sleep(3500);
      this.bot.clearControlStates();
      return;
    }

    // Lava/fire check first — instant death risk
    if (this.perception.isInLava && this.perception.isInLava()) {
      await this._escapeLava();
      return;
    }

    // Check for immediate hostile threats right at spawn
    if (this.combat) {
      const threat = this.combat.assessThreat(false);
      if (threat === 'retreat' || threat === 'fight') {
        console.log('[Survival] Hostile threat detected immediately on respawn — reacting now');
        const { hostile } = this.perception.scanEntities(16);
        if (hostile && hostile.length && hostile[0].entity && hostile[0].entity.position) {
          await this.navigation.fleeFrom(hostile[0].entity.position, 24);
        }
      }
    }
  }

  async retrieveDeathItems() {
    if (!this._deathPos) return false;
    const deathPos = this._deathPos;
    const timeLeft = this.ITEM_DESPAWN_MS - (Date.now() - this._deathTime);
    console.log('[Survival] Going to retrieve items (' + Math.floor(timeLeft/1000) + 's left)');

    // Clear any hostiles near us BEFORE heading toward the death location —
    // walking past/through a mob to grab loot just gets us killed again.
    // This is priority: kill what's blocking the way, THEN retrieve.
    if (this.combat) {
      const threat = this.combat.assessThreat(true);
      if (threat === 'fight') {
        console.log('[Survival] Clearing nearby threats before retrieving items');
        await this.combat.clearArea();
        return false; // re-enter retrieval next tick now that the area's safer
      } else if (threat === 'retreat') {
        console.log('[Survival] Too dangerous to retrieve right now — backing off');
        return false; // keep _deathPos set, try again next tick
      }
    }

    // If the death spot itself is underwater, don't dive back in — that's
    // exactly what caused the death. Get close on the surface and grab
    // whatever floats up instead of swimming into the same hazard.
    const deathBlock = this.bot.blockAt(deathPos);
    const isWaterDeath = deathBlock && (deathBlock.name === 'water' || deathBlock.name === 'flowing_water');
    const tolerance = isWaterDeath ? 8 : 4;

    if (isWaterDeath && this._retrievalAttempts === 0) {
      console.log('[Survival] Death location is underwater — staying on the surface nearby');
    }

    this._retrievalAttempts = (this._retrievalAttempts || 0) + 1;

    const arrived = await this.navigation.moveTo(deathPos, tolerance);

    if (arrived) {
      await this._sleep(800);

      // Re-check for threats that may have appeared while traveling —
      // kill first, then keep collecting.
      if (this.combat && this.combat.assessThreat(true) !== 'none') {
        console.log('[Survival] Threat appeared at death location — dealing with it first');
        await this.combat.clearArea();
      }

      const items = Object.values(this.bot.entities).filter(function(e) {
        return e.type === 'object' && e.name === 'item' &&
               e.position.distanceTo(deathPos) < 12;
      });
      console.log('[Survival] Found ' + items.length + ' item drops at death location');

      if (items.length === 0) {
        // Nothing here (already collected, or despawned) — done.
        this._deathPos = null;
        this._deathTime = null;
        this._retrievalAttempts = 0;
        return true;
      }

      for (const item of items) {
        if (!item.isValid) continue;
        const dy = this.bot.entity.position.y - item.position.y;
        if (isWaterDeath && dy > 2) continue;
        try {
          await this.navigation.moveTo(item.position, 1);
          await this._sleep(150);
        } catch(e) {}
      }

      // Successfully reached and processed the area — done.
      this._deathPos = null;
      this._deathTime = null;
      this._retrievalAttempts = 0;
      return true;
    }

    // Could not path there this attempt. Retry a handful of times before
    // giving up — a single pathfinding failure (e.g. brief obstruction)
    // shouldn't cost the bot his entire inventory permanently.
    console.log('[Survival] Could not reach death location (attempt ' + this._retrievalAttempts + ')');
    if (this._retrievalAttempts >= 6) {
      console.log('[Survival] Giving up on retrieval after repeated failures');
      this._deathPos = null;
      this._deathTime = null;
      this._retrievalAttempts = 0;
    }
    // Otherwise keep _deathPos set so this stays top priority next tick.
    return false;
  }

  // ── eating ────────────────────────────────────────────────

  async eat() {
    if (this._eating) return false;
    const foodName = this.inventory.getBestFood();
    if (!foodName) { console.warn('[Survival] No food!'); return false; }
    this._eating = true;
    try {
      const item = this.inventory.getItem(foodName);
      if (!item) return false;
      await this.bot.equip(item, 'hand');
      await this._sleep(100);
      this.bot.activateItem();
      await this._sleep(1600);
      this.bot.deactivateItem();
      console.log(`[Survival] Ate ${foodName}. Food: ${this.bot.food}`);
      return true;
    } catch(e) {
      console.warn('[Survival] Eat failed:', e.message);
      return false;
    } finally {
      this._eating = false;
    }
  }

  async eatUntilFull() {
    let tries = 0;
    while (this.perception.isHungry() && this.inventory.hasFood() && tries < 5) {
      await this.eat(); tries++;
      await this._sleep(300);
    }
  }

  // ── lava ─────────────────────────────────────────────────

  _escapeLava() {
    if (this._inDanger) return;
    this._inDanger = true;
    console.warn('[Survival] In lava!');
    this.memory.addDangerZone(this.bot.entity.position, 'lava');
    this.bot.setControlState('jump', true);
    this.bot.setControlState('forward', true);
    setTimeout(() => {
      this.bot.setControlState('jump', false);
      this.bot.setControlState('forward', false);
      this._inDanger = false;
    }, 3000);
  }

  // ── safety checks ─────────────────────────────────────────

  async runSafetyChecks() {
    if (this.perception.isOnFire()) {
      this.bot.setControlState('forward', true);
      await this._sleep(1000);
      this.bot.setControlState('forward', false);
      return true;
    }
    if (this.bot.food <= config.survival.criticalHungerThreshold) {
      await this.eatUntilFull(); return true;
    }
    if (this.perception.isLowHealth() && this.inventory.hasFood()) {
      await this.eatUntilFull(); return true;
    }
    return false;
  }

  status() {
    return {
      health: this.bot.health, food: this.bot.food,
      isNight: this.perception.isNight(),
      pendingDeath: !!this._deathPos,
      deathSecondsLeft: this._deathTime
        ? Math.max(0, Math.floor((this.ITEM_DESPAWN_MS - (Date.now()-this._deathTime))/1000))
        : 0,
    };
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = SurvivalSystem;
