const mineflayer  = require('mineflayer');
const config      = require('./config');

const MemorySystem     = require('./memorySystem');
const Perception       = require('./perception');
const Navigation       = require('./navigation');
const InventoryManager = require('./inventoryManager');
const ResourceManager  = require('./resourceManager');
const CraftingSystem   = require('./craftingSystem');
const StorageSystem    = require('./storageSystem');
const CombatSystem     = require('./combatSystem');
const SurvivalSystem   = require('./survivalSystem');
const BuildingSystem   = require('./buildingSystem');
const FarmingSystem    = require('./farmingSystem');
const { GoalPlanner }  = require('./goalPlanner');
const LearningSystem   = require('./learningSystem');
const { RewardSystem } = require('./rewardSystem');
const ActivityLog      = require('./activityLog');

const STATE = {
  INIT:'INIT', SURVIVE:'SURVIVE', COMBAT:'COMBAT',
  SHELTER:'SHELTER', GOAL:'GOAL', EXPLORE:'EXPLORE',
  RETRIEVE:'RETRIEVE', SLEEP:'SLEEP',
};

class AutonomousBot {
  constructor() {
    this.state     = STATE.INIT;
    this.running   = false;
    this.tickTimer = null;
    this._stuckCheckInterval = null;
    this._lastEquipCheck = 0;
    this._retreatFromPos = null;
  }

  start() {
    console.log('='.repeat(60));
    console.log('  Autonomous Minecraft Bot — Starting');
    console.log('='.repeat(60));
    console.log(`Connecting to ${config.bot.host}:${config.bot.port} as ${config.bot.username}`);
    this.bot = mineflayer.createBot({
      host:    config.bot.host,
      port:    config.bot.port,
      username:config.bot.username,
      auth:    config.bot.auth,
      version: config.bot.version || undefined,
    });
    this.bot.once('spawn', () => this._onSpawn());
    this.bot.on('error',   e  => console.error('[Bot] Error:', e.message));
    this.bot.on('kicked',  r  => console.error('[Bot] Kicked:', r));
    this.bot.on('end',     () => this._onDisconnect());
    this.bot.on('chat',    (u,m) => this._handleChat(u,m));
  }

  async _onSpawn() {
    console.log('[Bot] Spawned! Initialising subsystems...');
    this.memory     = new MemorySystem(this.bot);
    this.perception = new Perception(this.bot);
    this.nav        = new Navigation(this.bot, this.memory);
    this.inv        = new InventoryManager(this.bot);
    this.survival   = new SurvivalSystem(this.bot, this.perception, this.inv, this.nav, this.memory);
    this.resource   = new ResourceManager(this.bot, this.perception, this.nav, this.inv, this.memory);
    this.crafting   = new CraftingSystem(this.bot, this.inv, this.nav, this.memory);
    this.storage    = new StorageSystem(this.bot, this.inv, this.nav, this.memory);
    this.activityLog = new ActivityLog();
    this.combat     = new CombatSystem(this.bot, this.perception, this.nav, this.inv, this.survival, this.memory, this.activityLog);
    this.resource.setCombat(this.combat);  // lets gather loops bail out on threats
    this.survival.setCombat(this.combat);  // lets retrieval clear threats first
    this.building   = new BuildingSystem(this.bot, this.inv, this.nav, this.memory);
    this.farming    = new FarmingSystem(this.bot, this.inv, this.nav, this.memory);
    this.learning   = new LearningSystem(this.bot);
    this.survival.setLearning(this.learning); // lets immediate-spawn-check detect death clusters
    this.reward     = new RewardSystem(this.learning);
    this.planner    = new GoalPlanner({
      bot: this.bot, learning: this.learning, reward: this.reward,
      inv: this.inv, resource: this.resource, crafting: this.crafting,
      storage: this.storage, combat: this.combat, survival: this.survival,
      building: this.building, farming: this.farming, memory: this.memory, nav: this.nav, perception: this.perception,
    });

    this.memory.setBase(this.bot.entity.position.clone());
    const mainBase = this.building.consolidateBases();
    if (mainBase) {
      console.log('[Bot] Using persistent main base at ' +
        Math.floor(mainBase.x) + ',' + Math.floor(mainBase.y) + ',' + Math.floor(mainBase.z));
      this.memory.setBase(mainBase);
    }
    this._stuckCheckInterval = setInterval(() => this._checkStuck(), 15000);

    // ── Learning + Reward: track deaths ───────────────────────
    this.bot.on('death', () => {
      const hostile = this.perception.nearestHostile(8);
      const cause = hostile ? hostile.name : 'unknown';
      const repeatCount = (this.learning.data.deathCauses[cause] || 0);
      const heldItem = this.bot.heldItem ? this.bot.heldItem.name : null;

      this.activityLog.logDeath(cause, this.bot.entity.position, heldItem);

      this.reward.record('DEATH', cause, repeatCount);
      const episodeScore = this.reward.endEpisode();
      console.log('[Reward] Life ended with net score ' + episodeScore.toFixed(1));

      this.learning.recordDeath(cause, this.bot.entity.position);
    });

    // ── Learning: use combat advice (fight/flee weighting) ────
    this.bot.on('entityHurt', (entity) => {
      if (entity !== this.bot.entity) return;
      const mob = this.perception.nearestHostile(8);
      if (!mob) return;

      const heuristicAdvice = this.learning.shouldFightOrFlee(mob.name, this.bot.health);
      const fightW = this.reward.getWeight('fight', mob.name);
      const fleeW  = this.reward.getWeight('flee', mob.name);
      const weightAdvice = fleeW > fightW ? 'flee' : 'fight';

      const advice = (heuristicAdvice === 'flee' || weightAdvice === 'flee') ? 'flee' : 'fight';

      if (advice === 'flee' && !this.combat.isInCombat()) {
        console.log('[Bot] Learning says flee from ' + mob.name +
          ' (fightW=' + fightW.toFixed(1) + ' fleeW=' + fleeW.toFixed(1) + ')');
        this.nav.fleeFrom(mob.position, 20).catch(() => {});
      }
    });

    // Auto-equip best sword whenever inventory changes
    this.bot.on('playerCollect', async () => { await this._autoEquipSword(); });

    this.running = true;
    this.state   = STATE.GOAL;
    console.log('[Bot] All systems online.\n');

    await this._autoEquipSword();
    this._tick();
  }

  async _autoEquipSword() {
    const now = Date.now();
    if (now - this._lastEquipCheck < 2000) return;
    this._lastEquipCheck = now;
    const sword = await this.inv.equipBestSword();
    if (sword) console.log(`[Bot] Equipped ${sword}`);
    const armor = await this.inv.equipAllArmor();
    if (armor.length) console.log('[Bot] Equipped armor: ' + armor.join(' '));
  }

  async _tick() {
    if (!this.running) return;
    try { await this._decide(); }
    catch(e) { console.error('[Bot] Tick error:', e.message); console.error(e.stack); }
    this.tickTimer = setTimeout(() => this._tick(), config.stateMachine.tickInterval);
  }

  async _decide() {
    const world = this.perception.worldSnapshot();

    // ── 1. Immediate danger ─────────────────────────────────
    if (world.isInLava || world.isOnFire || world.isCriticalHealth) {
      this._setState(STATE.SURVIVE);
      await this.survival.runSafetyChecks();
      return;
    }

    // ── 2. Combat / flee ────────────────────────────────────
    const hasShelter = this.building.isShelterBuilt();
    const threat = this.combat.assessThreat(hasShelter);

    if (threat === 'retreat') {
      this._setState(STATE.SHELTER);
      const mob = this.perception.nearestHostile();

      // Remember roughly where the fight was so we can come back once healed
      if (mob && !this._retreatFromPos) {
        this._retreatFromPos = mob.position.clone();
      }

      if (mob) await this.nav.fleeFrom(mob.position, 24);

      // While retreating, actively try to heal — eat if we have food.
      // Without this, HP never recovers and the bot just flees forever
      // instead of ever coming back to finish the fight.
      if (world.health < 18 && this.inv.hasFood()) {
        await this.survival.eatUntilFull();
      }
      return;
    }

    // Healed back up after a retreat — go finish what we started instead
    // of abandoning the fight permanently. Only do this if the original
    // threat is still somewhat nearby; if we've wandered far away or a
    // lot of time passed, just let normal goal logic resume instead.
    if (this._retreatFromPos && this.combat.isHealedEnoughToReengage()) {
      const distToOldFight = this.bot.entity.position.distanceTo(this._retreatFromPos);
      if (distToOldFight < 30) {
        console.log('[Bot] Healed up — returning to finish the fight');
        this._setState(STATE.COMBAT);
        await this.inv.equipBestSword();
        await this.nav.moveTo(this._retreatFromPos, 4);
        await this.combat.clearArea();
      }
      this._retreatFromPos = null;
    }

    if (threat === 'fight') {
      if (world.isNight && !hasShelter) {
        const mob = this.perception.nearestHostile();
        if (mob) {
          this._setState(STATE.SHELTER);
          await this.nav.fleeFrom(mob.position, 24);
        }
      } else {
        this._setState(STATE.COMBAT);
        await this.inv.equipBestSword();
        const before = this.bot.health;
        await this.combat.clearArea();

        const mob = this.perception.nearestHostile();
        if (!mob) {
          const dmgTaken = before - this.bot.health;
          this.reward.record('MOB_KILLED', 'combat');
          if (dmgTaken < 2) this.reward._updateWeight('fight', 'general', 2);
          this._retreatFromPos = null; // fight resolved cleanly, nothing to return to
        }
        await this._autoEquipSword();
      }
      return;
    }

    // ── 3. Retrieve death items ──────────────────────────────
    if (this.survival.hasPendingDeathRetrieval()) {
      this._setState(STATE.RETRIEVE);
      await this.survival.retrieveDeathItems();
      return;
    }

    // ── 3.5 Return home after death if we have a shelter and wandered off ──
    // Without this, the bot just starts gathering wood wherever it respawned,
    // eventually wandering far enough that the old base gets abandoned and
    // rebuilt from scratch every single life.
    if (hasShelter) {
      const base = this.memory.getBase();
      if (base) {
        const distFromBase = this.bot.entity.position.distanceTo(base);
        if (distFromBase > 40 && this.inv.occupiedSlots() <= 2) {
          this._setState(STATE.SHELTER);
          console.log('[Bot] Heading back to base (' + Math.floor(distFromBase) + ' blocks away)');
          await this.nav.moveTo(base, 5);
          return;
        }
      }
    }

    // ── 4. Night ─────────────────────────────────────────────
    if (world.isNight) {
      const hasBed = !!this.memory.bedLocation;

      if (hasShelter && hasBed && this.state !== STATE.SLEEP) {
        this._setState(STATE.SLEEP);
        await this._trySleep();
        this.reward.record('SURVIVED_NIGHT', 'sleep');
        return;
      }

      if (hasShelter && !hasBed) {
        if (this.state !== STATE.SHELTER) {
          this._setState(STATE.SHELTER);
          const base = this.memory.getBase();
          if (base) await this.nav.moveTo(base, 3);
          this.nav.stop();
          console.log('[Bot] Night — inside shelter, waiting for morning');
        }
        return;
      }
      // No shelter — keep working on goals but flee mobs (falls through)
    }

    // ── 5. Heal — when hurt, prioritize recovering HP over goal work ────
    // This is separate from hunger-based eating below: even with decent
    // food, the bot should react to having taken damage, not just wait
    // until it's starving to eat.
    const isHurt = world.health < 16; // out of 20 — meaningfully damaged
    if (isHurt) {
      if (this.inv.hasFood()) {
        console.log('[Bot] Hurt (' + world.health + ' HP) — eating to recover');
        await this.survival.eatUntilFull();
        return;
      }
      // Emergency fallback: rotten flesh from zombie kills. Not in the
      // normal foodItems list (food poisoning risk), but starving while
      // hurt is worse than the risk — only used when nothing better exists.
      if (this.inv.count('rotten_flesh') > 0) {
        console.log('[Bot] Hurt with no good food — eating rotten flesh as emergency ration');
        try {
          const item = this.inv.getItem('rotten_flesh');
          if (item) { await this.bot.equip(item, 'hand'); await this.bot.consume(); }
        } catch(e) {}
        return;
      }
      // No food — if it's night and we have a bed nearby, sleep to heal.
      // Sleeping in vanilla Minecraft restores health over time same as
      // food saturation, and skips the dangerous night entirely. During
      // the day this isn't possible — health will recover slowly from
      // saturation regardless, so we just continue more cautiously.
      const bedPos = this.memory.bedLocation;
      if (bedPos && hasShelter && world.isNight) {
        const distToBed = this.bot.entity.position.distanceTo(bedPos);
        if (distToBed < 30) {
          console.log('[Bot] Hurt with no food — resting in bed to recover');
          this._setState(STATE.SLEEP);
          await this._trySleep();
          return;
        }
      }
      // Otherwise fall through — nothing more we can do right now,
      // combat/flee logic above still applies and natural regen continues.
    }

    // ── 5.5 Eat — hunger-based, even when not specifically "hurt" ───────
    if (world.food <= config.survival.hungerThreshold) {
      if (this.inv.hasFood()) {
        await this.survival.eatUntilFull();
        return;
      }
      // Same emergency fallback for plain hunger, not just combat damage
      if (this.inv.count('rotten_flesh') > 0) {
        console.log('[Bot] Starving with no good food — eating rotten flesh');
        try {
          const item = this.inv.getItem('rotten_flesh');
          if (item) { await this.bot.equip(item, 'hand'); await this.bot.consume(); }
        } catch(e) {}
        return;
      }
    }

    // ── 6. Inventory full ───────────────────────────────────
    if (world.inventoryFull) {
      const deposited = await this.storage.depositItems();
      if (!deposited) await this.inv.dropJunk();
      return;
    }

    // ── 7. Goals ────────────────────────────────────────────
    this._setState(STATE.GOAL);
    const goal = this.planner.getActiveGoal();
    if (!goal) {
      this._setState(STATE.EXPLORE);
      await this._autoEquipSword();
      await this.nav.exploreStep();
      return;
    }

    console.log('\n[Bot] Goal: ' + goal.id + ' | Task: ' + goal.taskName);
    this.activityLog.logGoal(goal.id, goal.taskName);
    try { this.bot.chat('[AI] ' + goal.id + ': ' + goal.taskName); } catch(e) {}

    const result = await this.planner.runNextTask(goal);

    if (result.success) {
      if (goal.taskName.includes('craft')) {
        this.reward.record('CRAFT_SUCCESS', goal.taskName);
      }
      if (goal.taskName === 'build_shelter' && this.building.isShelterBuilt()) {
        this.reward.record('SHELTER_COMPLETED', 'shelter');
        this.activityLog.logShelterProgress('completed', 'shelter built');
      }
      if (goal.taskName.includes('pickaxe') && goal.id === 'stone_tools') {
        this.reward.record('TOOL_TIER_UPGRADE', 'stone');
      }
      if (goal.taskName.includes('pickaxe') && goal.id === 'iron') {
        this.reward.record('TOOL_TIER_UPGRADE', 'iron');
      }
    } else {
      this.reward.record('FAILED_CRAFT', goal.taskName);
      console.warn(`[Bot] Task failed: ${result.taskName}`);
    }

    // Don't blindly re-equip the sword after every task — gather_wood/
    // gather_stone/gather_coal/gather_iron need the axe/pickaxe to stay
    // equipped, and re-equipping the sword here was overwriting that
    // every single tick, which is why the bot rarely seemed to use its
    // tools even though resourceManager was equipping them correctly.
    const isGatheringTask = goal.taskName.startsWith('gather_');
    if (!isGatheringTask) {
      await this._autoEquipSword();
    }
  }

  async _trySleep() {
    const bedPos = this.memory.bedLocation;
    if (!bedPos) return;
    if (!this.perception.isNight()) {
      console.log('[Bot] Can\'t sleep — it\'s daytime');
      return;
    }
    const bedBlock = this.bot.blockAt(bedPos);
    if (!bedBlock || !bedBlock.name.includes('bed')) return;
    try {
      await this.nav.moveTo(bedPos, 2);
      await this.bot.sleep(bedBlock);
      console.log('[Bot] Sleeping...');
      await new Promise(resolve => {
        const check = setInterval(() => {
          if (!this.perception.isNight()) { clearInterval(check); resolve(); }
        }, 1000);
      });
      await this.bot.wake();
      console.log('[Bot] Morning!');
    } catch(e) {
      console.warn('[Bot] Sleep failed:', e.message);
    }
  }

  async _checkStuck() {
    if (!this.running) return;
    if ([STATE.INIT, STATE.SHELTER, STATE.SLEEP].includes(this.state)) return;
    if (this.nav.isStuck()) {
      console.warn('[Bot] Stuck — recovering');
      this.reward.record('STUCK_RECOVERY', 'navigation');
      await this.nav.recoverFromStuck();
    }
  }

  _setState(s) {
    if (this.state !== s) { console.log(`[Bot] ${this.state} → ${s}`); this.state = s; }
  }

  async _handleChat(username, message) {
    if (username === this.bot.username) return;
    const cmd = message.toLowerCase().trim();

    if (cmd === '!status') {
      const p = this.planner.status();
      this.bot.chat(`State:${this.state} HP:${this.bot.health} Food:${this.bot.food} Goal:${p.activeGoal} Task:${p.activeTask}`);
    }
    if (cmd === '!goals') {
      const s = this.planner.status();
      this.bot.chat('Goal: ' + s.activeGoal + ' | Task: ' + s.activeTask);
      this.bot.chat('Next: ' + s.nextGoal + ' | ' + s.nextTask);
    }
    if (cmd === '!inventory') {
      const items = Object.entries(this.inv.all()).filter(([,c])=>c>0);
      const str = items.map(([n,c])=>`${n}:${c}`).join(' ');
      for (let i = 0; i < str.length; i += 200) this.bot.chat(str.slice(i, i+200) || 'empty');
    }
    if (cmd === '!equip')   { await this.inv.equipBestSword(); this.bot.chat('Equipped best sword'); }
    if (cmd === '!tools') {
      const has = (n) => this.inv.has(n) ? 'yes' : 'no';
      this.bot.chat('axe:' + has('wooden_axe') + '/' + has('stone_axe') +
        ' pickaxe:' + has('wooden_pickaxe') + '/' + has('stone_pickaxe') +
        ' sword:' + has('wooden_sword') + '/' + has('stone_sword'));
      this.bot.chat('Holding: ' + (this.bot.heldItem ? this.bot.heldItem.name : 'nothing'));
    }
    if (cmd === '!come')    { const p = this.bot.players[username]; if (p?.entity) { this.bot.chat('Coming!'); await this.nav.moveToEntity(p.entity, 3); } }
    if (cmd === '!learning') {
      const s = this.learning.summary();
      this.bot.chat('Deaths:' + s.totalDeaths + ' Killer:' + s.topKiller + ' Streak:' + s.survivalStreak + 'd');
    }
    if (cmd === '!reward' || cmd === '!stats') {
      const liveScore = this.reward.episodeLog.reduce((s, e) => s + e.scaled, 0);
      this.bot.chat('Current life score: ' + liveScore.toFixed(1) + ' (' + this.reward.episodeLog.length + ' events)');
      const fightCreeper = this.reward.getWeight('fight', 'creeper');
      const fleeCreeper  = this.reward.getWeight('flee', 'creeper');
      this.bot.chat('Creeper weights — fight:' + fightCreeper.toFixed(1) + ' flee:' + fleeCreeper.toFixed(1));
    }
    if (cmd === '!weapons') {
      const report = this.activityLog.weaponReport();
      const entries = Object.entries(report).filter(([,v]) => v);
      if (!entries.length) { this.bot.chat('Not enough combat data yet'); }
      for (const [mob, data] of entries.slice(0, 5)) {
        this.bot.chat(mob + ': best weapon ' + data.weapon + ' (' + data.winRate + ' win rate)');
      }
    }
    if (cmd === '!activity') {
      const s = this.activityLog.summaryForChat();
      this.bot.chat('Deaths:' + s.totalDeaths + ' TopCause:' + s.topCause +
        ' UnarmedFights:' + s.fightsWithNoWeapon + '/' + s.totalFights);
    }
    if (cmd === '!storage') {
      this.bot.chat('Chest contents: ' + this.storage.summary());
      this.bot.chat('Walls upgraded: ' + this.building.isUpgradedToStone());
    }
    if (cmd === '!armor') {
      const slots = ['helmet','chestplate','leggings','boots'];
      const tiers = ['iron','leather'];
      const parts = [];
      for (const slot of slots) {
        let found = 'none';
        for (const tier of tiers) {
          if (this.inv.has(tier + '_' + slot)) { found = tier; break; }
        }
        parts.push(slot + ':' + found);
      }
      this.bot.chat(parts.join(' '));
    }
    if (cmd === '!base') {
      const main = this.building.getMainBase();
      this.bot.chat('Main base: ' + (main ? Math.floor(main.x)+','+Math.floor(main.y)+','+Math.floor(main.z) : 'none yet'));
      this.bot.chat('Stone walls: ' + this.building.isUpgradedToStone() + ' | Wings built: ' + this.building.expansionCount());
    }
    if (cmd === '!farm') {
      this.bot.chat('Farm plots: ' + this.farming.farmPlotCount());
    }
    if (cmd === '!stop')    { this.running = false; this.nav.stop(); this.bot.chat('Stopped.'); }
    if (cmd === '!start')   { this.running = true; this.state = STATE.GOAL; this._tick(); this.bot.chat('Started.'); }
  }

  _onDisconnect() {
    console.log('[Bot] Disconnected — reconnecting in 5s...');
    this.running = false;
    clearTimeout(this.tickTimer);
    clearInterval(this._stuckCheckInterval);
    setTimeout(() => this.start(), 5000);
  }
}

const bot = new AutonomousBot();
bot.start();
