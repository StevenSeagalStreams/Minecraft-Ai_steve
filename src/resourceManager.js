const { Vec3 } = require('vec3');
const config   = require('./config');

class ResourceManager {
  constructor(bot, perception, navigation, inventory, memory) {
    this.bot        = bot;
    this.perception = perception;
    this.navigation = navigation;
    this.inventory  = inventory;
    this.memory     = memory;
    this.combat     = null; // wired in via setCombat() after CombatSystem exists
    console.log('[Resource] Manager initialised');
  }

  setCombat(combat) { this.combat = combat; }

  // Called at the top of every gather-loop iteration. If a hostile is
  // spotted nearby — even before it deals damage — stop gathering and
  // let main.js's decision loop take over to fight or flee. This closes
  // the gap where a 20-60s gatherWood/gatherStone call would otherwise
  // block all threat-checking until it naturally finished.
  _threatInterrupt() {
    if (!this.combat) return false;
    const threat = this.combat.assessThreat(true); // conservative: assume no shelter check needed here
    return threat === 'fight' || threat === 'retreat';
  }

  // Skip tool-equipping if combat has taken over the hand slot
  async _safeEquipAxe() {
    if (this.bot._inCombatLock) return;
    await this.inventory.equipBestAxe();
  }

  async _safeEquipPickaxe() {
    if (this.bot._inCombatLock) return;
    await this.inventory.equipBestPickaxe();
  }

  _woodCount() {
    return config.gathering.woodTypes.reduce((s, w) => s + this.inventory.count(w), 0);
  }

  // Find nearest reachable block — skips blacklisted positions
  _findNearest(blockNames, maxDist = 64) {
    let best = null, bestDist = Infinity;
    for (const name of blockNames) {
      const bt = this.bot.registry.blocksByName[name];
      if (!bt) continue;
      // findBlock finds closest by default
      let found = this.bot.findBlock({
        matching: bt.id,
        maxDistance: maxDist,
        useExtraInfo: false,
      });
      while (found) {
        if (!this.memory.isBlacklisted(found.position)) {
          const d = this.bot.entity.position.distanceTo(found.position);
          if (d < bestDist) { bestDist = d; best = found; }
        }
        break; // findBlock only returns one; we take it
      }
    }
    return best;
  }

  // Find the BOTTOM log of a tree
  _treeBase(block) {
    let pos = block.position.clone();
    for (let dy = 1; dy <= 25; dy++) {
      const b = this.bot.blockAt(pos.offset(0, -dy, 0));
      if (!b || b.name !== block.name) {
        const baseBlock = this.bot.blockAt(pos.offset(0, -(dy-1), 0));
        return baseBlock || block;
      }
    }
    return block;
  }

  // Check if bot can reach a position (ground level within 2 blocks)
  _canReach(pos) {
    const botY   = this.bot.entity.position.y;
    const blockY = pos.y;
    // Can reach if within 5 blocks height difference
    return Math.abs(blockY - botY) <= 5;
  }

  async _mineBlock(pos, logName) {
    const block = this.bot.blockAt(pos);
    if (!block || block.name !== logName) return false;
    try {
      const dist = this.bot.entity.position.distanceTo(pos);
      if (dist > 4.5) {
        const ok = await this.navigation.moveTo(pos, 3);
        if (!ok) return false;
      }
      await this.bot.lookAt(pos.offset(0.5, 0.5, 0.5));
      await this._sleep(80);
      const fresh = this.bot.blockAt(pos);
      if (fresh && fresh.name === logName && this.bot.canDigBlock(fresh)) {
        await this.bot.dig(fresh);
        return true;
      }
    } catch(e) {}
    return false;
  }

  async _mineTree(baseBlock) {
    const logName = baseBlock.name;
    const basePos = baseBlock.position.clone();

    // Move to base of tree first
    const arrived = await this.navigation.moveTo(basePos, 3);
    if (!arrived) {
      console.log('[Resource] Cannot reach tree base — blacklisting');
      this.memory.blacklistPosition(basePos);
      return 0;
    }

    await this._safeEquipAxe();
    let mined = 0;

    // Mine upward — only blocks we can actually reach
    for (let dy = 0; dy <= 25; dy++) {
      const pos   = basePos.offset(0, dy, 0);
      const block = this.bot.blockAt(pos);
      if (!block || block.name !== logName) break;

      const botY   = this.bot.entity.position.y;
      const blockY = pos.y;
      const heightDiff = blockY - botY;

      // If block is more than 5 blocks above us, try to jump up
      if (heightDiff > 5) {
        // Try moving to a position one block below this log
        const below = pos.offset(0, -1, 0);
        const movedUp = await this.navigation.moveTo(below, 2);
        if (!movedUp) {
          console.log(`[Resource] Cannot reach log at height ${dy} — stopping`);
          break;
        }
      }

      const ok = await this._mineBlock(pos, logName);
      if (ok) {
        mined++;
        await this._sleep(150);
      } else {
        break; // Can't mine this block, stop going up
      }
    }

    // Mine side branches only at reachable heights
    const botY = this.bot.entity.position.y;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = 0; dy <= 12; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (dx === 0 && dz === 0) continue;
          const pos   = basePos.offset(dx, dy, dz);
          const block = this.bot.blockAt(pos);
          if (!block || block.name !== logName) continue;
          // Only try branches within reasonable reach
          if (Math.abs(pos.y - this.bot.entity.position.y) > 5) continue;
          const dist = this.bot.entity.position.distanceTo(pos);
          if (dist > 4.5) {
            await this.navigation.moveTo(pos, 3);
          }
          try {
            const fresh = this.bot.blockAt(pos);
            if (fresh && fresh.name === logName && this.bot.canDigBlock(fresh)) {
              await this.bot.lookAt(pos.offset(0.5,0.5,0.5));
              await this.bot.dig(fresh);
              mined++;
              await this._sleep(150);
            }
          } catch(e) {}
        }
      }
    }

    return mined;
  }

  // ── public gather methods ─────────────────────────────────

  async gatherWood(targetCount = 16) {
    console.log(`[Resource] Gathering wood (target: ${targetCount})`);
    let attempts = 0;
    let consecutiveFailures = 0;
    const maxAttempts = 40; // raised from 25 — sparse terrain needs more tries

    while (this._woodCount() < targetCount && attempts < maxAttempts) {
      attempts++;

      if (this._threatInterrupt()) {
        console.log('[Resource] Threat spotted — pausing wood gathering');
        return;
      }

      // Search radius grows the longer we go without finding anything —
      // starts at 96 blocks, expands up to 160 if the area is sparse.
      const searchRadius = Math.min(96 + consecutiveFailures * 16, 160);

      // Find nearest non-blacklisted wood block
      let block = null;
      for (const name of config.gathering.woodTypes) {
        const bt = this.bot.registry.blocksByName[name];
        if (!bt) continue;
        const found = this.bot.findBlock({ matching: bt.id, maxDistance: searchRadius });
        if (!found) continue;
        if (this.memory.isBlacklisted(found.position)) continue;
        block = found;
        break;
      }

      if (!block) {
        consecutiveFailures++;
        console.log('[Resource] No reachable wood (radius ' + searchRadius +
          ') — exploring further (' + consecutiveFailures + ')');
        // Explore further with each consecutive failure instead of the
        // same fixed 32-block step, to actually break out of a dead zone
        await this.navigation.exploreStep(32 + Math.min(consecutiveFailures * 8, 64));
        await this._sleep(500);
        continue;
      }

      consecutiveFailures = 0;

      // Always start from the bottom of the tree
      const base = this._treeBase(block);

      // Check if base is reachable height-wise
      const heightDiff = Math.abs(base.position.y - this.bot.entity.position.y);
      if (heightDiff > 8) {
        console.log(`[Resource] Tree base too high (${heightDiff} blocks) — blacklisting`);
        this.memory.blacklistPosition(base.position);
        this.memory.blacklistPosition(block.position);
        continue;
      }

      console.log(`[Resource] Mining tree at ${base.position} (dist: ${this.bot.entity.position.distanceTo(base.position).toFixed(1)})`);
      this.memory.addResourceDeposit(base.position, base.name);

      const mined = await this._mineTree(base);
      console.log(`[Resource] Mined ${mined} logs`);

      if (mined === 0) {
        this.memory.blacklistPosition(base.position);
        this.memory.blacklistPosition(block.position);
      }

      await this._sleep(200);
    }

    console.log(`[Resource] Wood done. Have: ${this._woodCount()}`);
  }

  async gatherStone(targetCount = 32) {
    console.log(`[Resource] Gathering stone (target: ${targetCount})`);
    let attempts = 0;
    await this._safeEquipPickaxe();

    while (this.inventory.count('cobblestone') < targetCount && attempts < 40) {
      attempts++;

      if (this._threatInterrupt()) {
        console.log('[Resource] Threat spotted — pausing stone gathering');
        return;
      }

      const botPos = this.bot.entity.position;
      const stoneNames = ['stone','cobblestone','deepslate','andesite','granite','diorite'];
      let block = null;

      for (const name of stoneNames) {
        const bt = this.bot.registry.blocksByName[name];
        if (!bt) continue;
        const found = this.bot.findBlock({ matching: bt.id, maxDistance: 48 });
        if (!found) continue;
        if (this.memory.isBlacklisted(found.position)) continue;
        if (found.position.y < botPos.y - 4) continue; // avoid digging into deep holes
        block = found;
        break;
      }

      if (!block) {
        await this.navigation.exploreStep(20);
        continue;
      }

      await this._safeEquipPickaxe();
      const arrived = await this.navigation.moveTo(block.position, 3);
      if (!arrived) { this.memory.blacklistPosition(block.position); continue; }

      const ok = await this._digStoneBlock(block.position);
      if (!ok) {
        this.memory.blacklistPosition(block.position);
      }
      await this._sleep(150);
    }
    console.log(`[Resource] Stone done. Cobblestone: ${this.inventory.count('cobblestone')}`);
  }

  // Robust single-block stone dig with retries and a fresh re-fetch each try
  async _digStoneBlock(pos) {
    for (let i = 0; i < 3; i++) {
      try {
        const fresh = this.bot.blockAt(pos);
        if (!fresh || fresh.name === 'air') return true; // already gone
        if (!this.bot.canDigBlock(fresh)) {
          // Move slightly closer and re-aim
          await this.navigation.moveTo(pos, 2);
          await this.bot.lookAt(pos.offset(0.5, 0.5, 0.5), true);
          await this._sleep(150);
          continue;
        }
        await this.bot.lookAt(pos.offset(0.5, 0.5, 0.5), true);
        await this._sleep(100);
        await this.bot.dig(fresh);
        return true;
      } catch(e) {
        console.warn(`[Resource] Stone dig attempt ${i+1} failed:`, e.message);
        await this._sleep(200);
      }
    }
    return false;
  }

  async gatherCoal(targetCount = 16) {
    console.log('[Resource] Gathering coal');
    let attempts = 0;
    await this._safeEquipPickaxe();
    while (this.inventory.count('coal') < targetCount && attempts < 20) {
      attempts++;
      if (this._threatInterrupt()) {
        console.log('[Resource] Threat spotted — pausing coal gathering');
        return;
      }
      const block = this.bot.findBlock({
        matching: (b) => ['coal_ore','deepslate_coal_ore'].includes(b.name),
        maxDistance: 64,
      });
      if (!block) { await this.navigation.exploreStep(24); continue; }
      await this._safeEquipPickaxe();
      const arrived = await this.navigation.moveTo(block.position, 3);
      if (!arrived) { this.memory.blacklistPosition(block.position); continue; }
      try {
        await this.bot.lookAt(block.position.offset(0.5,0.5,0.5));
        const fresh = this.bot.blockAt(block.position);
        if (fresh && this.bot.canDigBlock(fresh)) await this.bot.dig(fresh);
      } catch(e) {}
      await this._sleep(200);
    }
  }

  async gatherIron(targetCount = 16) {
    console.log('[Resource] Gathering iron');
    let attempts = 0;
    await this._safeEquipPickaxe();
    while ((this.inventory.count('raw_iron')+this.inventory.count('iron_ore')) < targetCount && attempts < 30) {
      attempts++;
      if (this._threatInterrupt()) {
        console.log('[Resource] Threat spotted — pausing iron gathering');
        return;
      }
      const block = this.bot.findBlock({
        matching: (b) => ['iron_ore','deepslate_iron_ore'].includes(b.name),
        maxDistance: 64,
      });
      if (!block) { await this.navigation.exploreStep(24); continue; }
      await this._safeEquipPickaxe();
      const arrived = await this.navigation.moveTo(block.position, 3);
      if (!arrived) { this.memory.blacklistPosition(block.position); continue; }
      try {
        await this.bot.lookAt(block.position.offset(0.5,0.5,0.5));
        const fresh = this.bot.blockAt(block.position);
        if (fresh && this.bot.canDigBlock(fresh)) await this.bot.dig(fresh);
      } catch(e) {}
      await this._sleep(200);
    }
  }

  resourceNeeds() {
    return {
      needWood:  this._woodCount() < config.gathering.minWoodInInventory,
      needStone: this.inventory.count('cobblestone') < config.gathering.minStoneInInventory,
      needCoal:  this.inventory.count('coal') < config.gathering.minCoalInInventory,
      needFood:  !this.inventory.hasFood(),
    };
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = ResourceManager;
