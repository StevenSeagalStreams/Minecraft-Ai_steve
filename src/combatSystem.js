// combatSystem.js
const { goals } = require('mineflayer-pathfinder');
const config = require('./config');

class CombatSystem {
  constructor(bot, perception, navigation, inventory, survival, memory, activityLog) {
    this.bot        = bot;
    this.perception = perception;
    this.navigation = navigation;
    this.inventory  = inventory;
    this.survival   = survival;
    this.memory     = memory;
    this.activityLog = activityLog || null;

    this._inCombat   = false;
    this._lastAttack = 0;
    this._COOLDOWN   = 500; // ms

    // Instant retaliation when hit
    this.bot.on('entityHurt', (entity) => {
      if (entity === this.bot.entity && !this._inCombat) {
        const mob = this.perception.nearestHostile(8);
        if (mob) {
          console.log(`[Combat] Hit by ${mob.name} — retaliating!`);
          this._fightEntity(mob).catch(() => {});
        }
      }
    });

    console.log('[Combat] System initialised');
  }

  // ── threat assessment ─────────────────────────────────────

  // Checks whether there's a relatively clear path to the entity —
  // not a perfect pathfinding check, but enough to reject mobs that are
  // clearly underground/behind walls (e.g. a skeleton in a cave below us).
  _isReachable(entity) {
    if (!entity || !entity.position) return false;

    const botPos = this.bot.entity.position.offset(0, 1.6, 0); // eye height
    const targetPos = entity.position.offset(0, entity.height ? entity.height * 0.5 : 1, 0);

    // Large vertical gap (more than ~4 blocks) almost always means the
    // target is in a cave, ravine, or otherwise behind solid terrain —
    // this catches the common "skeleton underground" case cheaply
    // without needing a full raycast.
    const verticalGap = Math.abs(botPos.y - targetPos.y);
    if (verticalGap > 4) return false;

    // Raycast from eyes to target — if a solid block is hit before
    // reaching the target, there's a wall/floor in the way.
    try {
      const dir = targetPos.minus(botPos);
      const dist = dir.norm();
      if (dist < 0.1) return true;
      dir.normalize();
      const hit = this.bot.world.raycast(botPos, dir, dist - 0.5);
      if (hit) return false; // something solid blocks the line of sight
    } catch(e) {
      // If raycast fails for any reason, fall back to allowing it —
      // better to occasionally chase an unreachable mob than to never
      // fight anything because of a raycast error.
      return true;
    }
    return true;
  }

  assessThreat(hasShelter) {
    const { hostile } = this.perception.scanEntities(16);
    // Only consider hostiles we can actually reach — ignore mobs that are
    // underground, behind walls, or otherwise walled off from us. Without
    // this, the bot enters COMBAT against an unreachable mob and gets
    // stuck trying to path to it forever.
    const reachableHostile = hostile.filter(h => this._isReachable(h.entity));
    if (!reachableHostile.length) return 'none';

    const hp = this.perception.getHealth();

    // Retreat much earlier than before — the goal is a fight/heal/
    // reengage cycle: back off while there's still a comfortable
    // margin, eat or wait to heal, then come back rather than fighting
    // down to nearly dead before disengaging.
    const retreatThreshold = hasShelter ? 12 : 14;
    if (hp <= retreatThreshold) return 'retreat';

    // Multiple hostiles — retreat even at decent HP, fighting 2+ at once
    // is how most unnecessary deaths happen.
    if (reachableHostile.length >= 2 && hp < 18) return 'retreat';

    // Creepers warrant retreat at close range UNLESS health is high and
    // it's the only threat — in that safer case, the hit-and-run tactic
    // in _fightEntity can handle it without melee-standing next to it.
    const creeper = reachableHostile.find(h => h.entity.name === 'creeper' && h.distance < 6);
    if (creeper) {
      const onlyThreat = reachableHostile.length === 1;
      if (!onlyThreat || hp < 16) return 'retreat';
      // else fall through to 'fight' — hit-and-run tactic takes over
    }

    return 'fight';
  }

  /** True once health is back to a safe level to resume fighting after a retreat. */
  isHealedEnoughToReengage() {
    return this.perception.getHealth() >= 18;
  }

  // ── area clear ────────────────────────────────────────────

  async clearArea() {
    await this.inventory.equipBestSword();
    this._inCombat = true;

    try {
      let rounds = 0;
      while (rounds < 40) {
        rounds++;

        const { hostile } = this.perception.scanEntities(16);
        const reachable = hostile.filter(h => this._isReachable(h.entity));
        if (!reachable.length) break;

        const hp = this.perception.getHealth();

        // Eat mid-combat if critically hungry
        if (this.bot.food < 6 && this.inventory.hasFood()) {
          await this.survival.eat();
        }

        // Retreat threshold now matches assessThreat (12-14 HP) instead
        // of fighting down to 4 — getting surrounded by 2-3 zombies and
        // refusing to disengage until nearly dead is exactly how most
        // "barely scratched them" deaths happened. Multiple attackers
        // means taking damage from several directions per round, so
        // back off much earlier than a 1-on-1 fight would require.
        const retreatHp = reachable.length >= 2 ? 14 : 8;
        if (hp <= retreatHp) {
          console.log('[Combat] HP too low for ' + reachable.length + ' attacker(s) — retreating');
          await this._retreat(reachable[0].entity);
          return false;
        }

        const target = this._pickTarget(reachable);
        if (!target) break;

        await this._fightEntity(target);
        await this._sleep(200);
      }

      console.log('[Combat] Area cleared');
      return true;
    } finally {
      this._inCombat = false;
      this.bot.pathfinder.setGoal(null);
      this.bot.clearControlStates();
    }
  }

  // ── fight single entity ───────────────────────────────────

  async _fightEntity(entity) {
    if (!entity || !entity.isValid) return false;
    this._inCombat = true;
    this.bot._inCombatLock = true; // global lock checked by resourceManager
    const mobName = entity.name;
    const isRanged = mobName === 'skeleton' || mobName === 'stray';
    const isCreeper = mobName === 'creeper';
    const hpBefore = this.perception.getHealth();
    await this.inventory.equipBestSword();
    const heldItem = this.bot.heldItem ? this.bot.heldItem.name : null;
    if (this.activityLog) this.activityLog.logToolUsage(heldItem, 'attack', mobName);

    // Creepers: never stand still in melee range. Hit-and-run only —
    // close in, land one hit, then immediately retreat several blocks
    // before it has a chance to start its fuse and detonate. This is
    // fundamentally different from normal melee combat below.
    if (isCreeper) {
      return await this._hitAndRunCreeper(entity, mobName, heldItem, hpBefore);
    }

    const wasInCombat = this._inCombat;
    this._inCombat = true;
    let chaseFailCount = 0;
    let lastPos = this.bot.entity.position.clone();

    try {
      let ticks = 0;
      while (entity.isValid && ticks < 80) {
        ticks++;

        const hp = this.perception.getHealth();
        if (hp <= 4) {
          await this._retreat(entity);
          return false;
        }

        const dist = this.bot.entity.position.distanceTo(entity.position);

        if (dist > config.combat.attackRange + 0.5) {
          // Detect if we're not actually closing the distance (e.g. mob
          // behind a wall, or we're physically stuck) — bail out instead
          // of looping pathfinder.setGoal for up to 24 seconds straight,
          // which blocks the entire bot (including stuck-recovery).
          const movedSinceLast = this.bot.entity.position.distanceTo(lastPos);
          if (movedSinceLast < 0.3) {
            chaseFailCount++;
          } else {
            chaseFailCount = 0;
          }
          lastPos = this.bot.entity.position.clone();

          if (chaseFailCount >= 5) {
            console.log('[Combat] Cannot reach ' + mobName + ' — giving up chase');
            this.bot.pathfinder.setGoal(null);
            return false;
          }

          // Ranged mobs (skeletons): every tick spent at range is a free
          // shot for them. Sprint straight at them with GoalNear (closer
          // tolerance, more aggressive pathing) instead of GoalFollow,
          // to close the gap as fast as possible rather than maintaining
          // a comfortable following distance.
          if (isRanged) {
            try {
              this.bot.setControlState('sprint', true);
              this.bot.pathfinder.setGoal(new goals.GoalNear(
                entity.position.x, entity.position.y, entity.position.z, 1
              ));
            } catch(e) {}
            await this._sleep(150); // shorter tick — react faster while closing
            continue;
          }

          // Chase — use pathfinder GoalFollow
          try {
            this.bot.pathfinder.setGoal(new goals.GoalFollow(entity, 2));
          } catch(e) {}
          await this._sleep(300);
          continue;
        }

        chaseFailCount = 0;
        this.bot.setControlState('sprint', false);

        // In range — stop and attack
        this.bot.pathfinder.setGoal(null);

        try {
          await this.bot.lookAt(
            entity.position.offset(0, entity.height * 0.85, 0), true
          );
        } catch(e) {}

        const now = Date.now();
        if (now - this._lastAttack >= this._COOLDOWN) {
          try {
            this.bot.attack(entity);
            this._lastAttack = now;
          } catch(e) {}
        }

        // Jump attack for bonus damage
        if (!this.bot.entity.onGround) {
          // already in air, good
        } else {
          this.bot.setControlState('jump', true);
          await this._sleep(100);
          this.bot.setControlState('jump', false);
        }

        await this._sleep(100);
      }

      const won = !entity.isValid;
      if (this.activityLog) {
        const hpAfter = this.perception.getHealth();
        this.activityLog.logCombat(mobName, heldItem, won ? 'won' : 'fled', hpBefore, hpAfter);
        this.activityLog.recordWeaponOutcome(mobName, heldItem, won);
      }
      return won;
    } finally {
      this.bot.pathfinder.setGoal(null);
      this.bot.setControlState('sprint', false);
      if (!wasInCombat) {
        this._inCombat = false;
        this.bot._inCombatLock = false;
      }
    }
  }

  /**
   * Approach a creeper just far enough to land one hit, then immediately
   * retreat before the fuse can trigger a detonation. A creeper needs to
   * sit near the player for a moment before exploding, so backing off
   * right after each hit resets that window — this lets the bot whittle
   * it down safely instead of either avoiding it forever or standing in
   * melee range like a normal mob (which gets it one-shot/heavily hurt).
   */
  async _hitAndRunCreeper(entity, mobName, heldItem, hpBefore) {
    const wasInCombat = this._inCombat;
    try {
      let ticks = 0;
      while (entity.isValid && ticks < 30) {
        ticks++;
        const hp = this.perception.getHealth();
        if (hp <= 8) {
          await this._retreat(entity);
          return false;
        }

        const dist = this.bot.entity.position.distanceTo(entity.position);

        if (dist > 3.5) {
          // Approach
          try {
            this.bot.pathfinder.setGoal(new goals.GoalNear(
              entity.position.x, entity.position.y, entity.position.z, 2
            ));
          } catch(e) {}
          await this._sleep(150);
          continue;
        }

        // In strike range — hit once
        this.bot.pathfinder.setGoal(null);
        try {
          await this.bot.lookAt(entity.position.offset(0, 0.5, 0), true);
          this.bot.attack(entity);
        } catch(e) {}

        await this._sleep(100);

        // Immediately back off before the fuse can ignite, regardless
        // of whether the hit landed — this is the core of the tactic.
        if (entity.isValid) {
          try {
            const away = this.bot.entity.position.minus(entity.position).normalize();
            const retreatPos = this.bot.entity.position.offset(away.x * 6, 0, away.z * 6);
            this.bot.pathfinder.setGoal(new goals.GoalNear(retreatPos.x, retreatPos.y, retreatPos.z, 1));
          } catch(e) {}
          await this._sleep(700);
          this.bot.pathfinder.setGoal(null);
        }
      }

      const won = !entity.isValid;
      if (this.activityLog) {
        const hpAfter = this.perception.getHealth();
        this.activityLog.logCombat(mobName, heldItem, won ? 'won' : 'fled', hpBefore, hpAfter);
        this.activityLog.recordWeaponOutcome(mobName, heldItem, won);
      }
      return won;
    } finally {
      this.bot.pathfinder.setGoal(null);
      if (!wasInCombat) {
        this._inCombat = false;
        this.bot._inCombatLock = false;
      }
    }
  }

  _pickTarget(hostile) {
    // Creeper — only engage via hit-and-run if it's the ONLY threat and
    // HP is comfortably high. With other mobs around, getting close to
    // a creeper while also being hit by something else is how it gets
    // a chance to actually detonate.
    const hp = this.perception.getHealth();
    const creeper = hostile.find(h => h.entity.name === 'creeper' && h.distance < 8);
    if (creeper && hp > 16 && hostile.length === 1) return creeper.entity;

    // Skeletons/strays next — every tick they're not the target, they're
    // free to keep shooting from range while we deal with something else.
    const archer = hostile.find(h => (h.entity.name === 'skeleton' || h.entity.name === 'stray'));
    if (archer) return archer.entity;

    // Otherwise nearest
    return hostile[0]?.entity || null;
  }

  async _retreat(fromEntity) {
    this.bot.pathfinder.setGoal(null);
    this.bot.clearControlStates();
    if (fromEntity?.position) {
      const isHostile = config.combat.hostileMobs.includes(fromEntity.name);
      if (isHostile) {
        this.memory.addDangerZone(fromEntity.position, `hostile:${fromEntity.name}`);
        console.log(`[Combat] Retreating from ${fromEntity.name}`);
      } else {
        // Retreating from low HP while hunting a passive mob for food —
        // don't pollute danger-zone memory with cows/sheep/fish.
        console.log(`[Combat] Backing off (low HP) while near ${fromEntity.name}`);
      }
      await this.navigation.fleeFrom(fromEntity.position, 20);
    }
  }

  async huntPassiveMob() {
    const { passive } = this.perception.scanEntities(32);
    if (!passive.length) return false;
    await this.inventory.equipBestSword();
    return this._fightEntity(passive[0].entity);
  }

  isInCombat() { return this._inCombat; }
  _sleep(ms)   { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = CombatSystem;
