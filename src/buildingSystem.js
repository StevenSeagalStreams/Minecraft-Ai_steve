// buildingSystem.js — Builds a real base around the crafting table
const { Vec3 } = require('vec3');
const fs   = require('fs');
const path = require('path');

const PLANK_TYPES = ['oak_planks','birch_planks','spruce_planks',
  'dark_oak_planks','jungle_planks','acacia_planks'];
const LOG_TYPES = ['oak_log','birch_log','spruce_log',
  'dark_oak_log','jungle_log','acacia_log'];

const MAIN_BASE_FILE = path.join(__dirname, 'main_base.json');

class BuildingSystem {
  constructor(bot, inventory, navigation, memory) {
    this.bot        = bot;
    this.inventory  = inventory;
    this.navigation = navigation;
    this.memory     = memory;

    this._shelterBuilt = false;
    this._baseCenter   = null;
    this._wallsUpgraded = false;
    this._expansions    = 0; // how many times the base has been expanded outward

    this._loadMainBase();
    console.log('[Building] System initialised');
  }

  // ── persistent main-base tracking ───────────────────────────
  // Survives bot restarts, so the bot always knows where its "real" home
  // is even across sessions, instead of treating every fresh spawn as a
  // reason to build a brand new scattered base.

  _loadMainBase() {
    try {
      if (fs.existsSync(MAIN_BASE_FILE)) {
        const data = JSON.parse(fs.readFileSync(MAIN_BASE_FILE, 'utf8'));
        if (data && typeof data.x === 'number') {
          this._mainBasePos = new Vec3(data.x, data.y, data.z);
          this._expansions  = data.expansions || 0;
          console.log('[Building] Loaded main base from disk: ' +
            Math.floor(data.x) + ',' + Math.floor(data.y) + ',' + Math.floor(data.z) +
            ' (expanded ' + this._expansions + 'x)');
        }
      }
    } catch(e) { /* no saved base yet, that's fine */ }
  }

  _saveMainBase() {
    if (!this._mainBasePos) return;
    try {
      fs.writeFileSync(MAIN_BASE_FILE, JSON.stringify({
        x: this._mainBasePos.x, y: this._mainBasePos.y, z: this._mainBasePos.z,
        expansions: this._expansions,
      }));
    } catch(e) { /* non-critical */ }
  }

  /** Returns the persistent main base position, or null if none set yet. */
  getMainBase() { return this._mainBasePos || null; }

  /**
   * Looks at every known crafting table location and decides which one
   * is the "real" main base — preferring one that also has a nearby
   * chest/bed (i.e. a fully built home), falling back to the first
   * table ever recorded. Once decided, this becomes sticky via disk
   * persistence so the bot stops scattering new bases across the map.
   */
  consolidateBases() {
    if (this._mainBasePos) return this._mainBasePos; // already decided

    const tables = Array.from(this.memory.craftingTables.values());
    if (!tables.length) return null;

    let best = null, bestScore = -1;
    for (const t of tables) {
      const pos = new Vec3(t.pos.x, t.pos.y, t.pos.z);
      let score = 0;
      if (this.memory.getNearestChest && this.memory.getNearestChest(pos)) score += 2;
      if (this.memory.bedLocation && pos.distanceTo(this.memory.bedLocation) < 10) score += 2;
      if (this.memory.getNearestFurnace(pos)) score += 1;
      if (score > bestScore) { bestScore = score; best = pos; }
    }

    this._mainBasePos = best || new Vec3(tables[0].pos.x, tables[0].pos.y, tables[0].pos.z);
    this._saveMainBase();
    console.log('[Building] Consolidated to main base at ' +
      Math.floor(this._mainBasePos.x) + ',' + Math.floor(this._mainBasePos.y) + ',' + Math.floor(this._mainBasePos.z));
    return this._mainBasePos;
  }

  isShelterBuilt() {
    if (!this._shelterBuilt || !this._baseCenter) return false;
    // Only abandon the old shelter and build a new one if we're truly far
    // away (e.g. died on the other side of the map). Walking back to an
    // existing base is always cheaper than rebuilding one from scratch.
    const dist = this.bot.entity.position.distanceTo(this._baseCenter);
    if (dist > 400) {
      console.log('[Building] Too far from old shelter (' + Math.floor(dist) + ' blocks) — will build a new one');
      this._shelterBuilt = false;
      return false;
    }
    return true;
  }
  getBaseCenter()  { return this._baseCenter; }

  _findCraftingTable() {
    const id = this.bot.registry.blocksByName['crafting_table']?.id;
    if (!id) return null;
    // Limit search radius — a crafting table from a previous life far away
    // should NOT be used as the shelter anchor for the bot's current position.
    return this.bot.findBlock({ matching: id, maxDistance: 16 });
  }

  // Counts whichever plank type(s) the bot is carrying
  _plankCount() {
    return PLANK_TYPES.reduce((s, p) => s + this.inventory.count(p), 0);
  }

  // Returns the plank type name with the most stock, or 'oak_planks' default
  _bestPlankType() {
    let best = 'oak_planks', bestCount = -1;
    for (const p of PLANK_TYPES) {
      const c = this.inventory.count(p);
      if (c > bestCount) { bestCount = c; best = p; }
    }
    return best;
  }

  async _convertLogsToPlanks(target) {
    for (const log of LOG_TYPES) {
      if (this._plankCount() >= target) break;
      const n = this.inventory.count(log);
      if (!n) continue;
      const plankName = log.replace('_log', '_planks');
      const id = this.bot.registry.itemsByName[plankName]?.id;
      if (!id) continue;
      try {
        const recipes = this.bot.recipesFor(id, null, 1, null);
        if (recipes.length) await this.bot.craft(recipes[0], n, null);
      } catch(e) {}
    }
  }

  // ── build a 5×5 shelter around a center point ──────────────
  // materialType: 'wood' (default, fast) or 'stone' (slower, needs pickaxe)

  async buildShelter(materialType) {
    materialType = materialType || 'wood';

    const table = this._findCraftingTable();
    let center = table
      ? table.position.clone()
      : this.bot.entity.position.floored();

    this._baseCenter = center;
    this.memory.setBase(center);

    const W = 6, D = 6, H = 3;
    const origin = center.offset(-Math.floor(W/2), 0, -Math.floor(D/2));
    const needed = this._estimateMaterial(W, D, H);

    let material;
    if (materialType === 'stone') {
      material = 'cobblestone';
    } else {
      // Convert any spare logs to planks before checking stock
      if (this._plankCount() < needed) await this._convertLogsToPlanks(needed);
      material = this._bestPlankType();
    }

    console.log(`[Building] Building base around ${center.x},${center.y},${center.z} using ${material}`);

    const have = this.inventory.count(material);
    console.log(`[Building] Have ${have} ${material}, need ~${needed}`);
    if (have < needed) {
      console.log(`[Building] Not enough ${material}`);
      return false;
    }

    // 1. Floor
    console.log('[Building] Laying floor...');
    for (let x = 0; x < W; x++)
      for (let z = 0; z < D; z++)
        await this._place(origin.offset(x, -1, z), material);

    // 2. Walls (door gap at front center, window gaps on sides)
    console.log('[Building] Building walls...');
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        for (let z = 0; z < D; z++) {
          const isWall = x===0 || x===W-1 || z===0 || z===D-1;
          if (!isWall) continue;
          if (z===0 && x===Math.floor(W/2) && y<2) continue;       // door
          if (y===1 && (x===0||x===W-1) && z===Math.floor(D/2)) continue; // windows
          await this._place(origin.offset(x, y, z), material);
        }
      }
    }

    // 3. Ceiling
    console.log('[Building] Adding roof...');
    for (let x = 0; x < W; x++)
      for (let z = 0; z < D; z++)
        await this._place(origin.offset(x, H, z), material);

    // 4. Door or seal with material
    const doorPos = origin.offset(Math.floor(W/2), 0, 0);
    const doorTypes = ['oak_door','birch_door','spruce_door','dark_oak_door','jungle_door','acacia_door'];
    let anyDoor = null;
    for (const d of doorTypes) {
      anyDoor = this.inventory.getItem(d);
      if (anyDoor) break;
    }
    if (anyDoor) {
      try {
        const ground = this.bot.blockAt(doorPos.offset(0,-1,0));
        if (ground) {
          await this.bot.equip(anyDoor, 'hand');
          await this.bot.placeBlock(ground, new Vec3(0,1,0));
        }
      } catch(e) {}
    } else {
      await this._place(doorPos, material);
      await this._place(doorPos.offset(0,1,0), material);
    }

    // 5. Torches
    if (this.inventory.has('torch')) {
      await this._place(origin.offset(1, 2, 1), 'torch');
      await this._place(origin.offset(W-2, 2, D-2), 'torch');
    }

    // 6. Chest
    await this._placeChestInside(origin, W, D);

    // 7. Bed
    await this._placeBedInside(origin, W, D);

    // 7.5 Furnace — for cooking food (and later smelting ore/iron)
    await this._placeFurnaceInside(origin, W, D);

    // 8. Confirm crafting table is actually inside — if the anchor table
    // somehow isn't within the walls (e.g. was on a corner/edge), craft
    // and place a fresh one in the center of the room.
    const tableCheckPos = origin.offset(Math.floor(W/2), 0, Math.floor(D/2));
    const tableBlock = this.bot.blockAt(tableCheckPos);
    if (!tableBlock || tableBlock.name !== 'crafting_table') {
      console.log('[Building] Crafting table not centered inside — placing a fresh one');
      await this._ensureCraftingTableAt(tableCheckPos);
    }

    // Summary so it's obvious from the log what actually got placed
    const hasTableNow   = this.bot.blockAt(tableCheckPos)?.name === 'crafting_table';
    const hasChestNow   = this.memory.getChests().length > 0;
    const hasBedNow     = !!this.memory.bedLocation;
    const hasFurnaceNow = !!this.memory.getNearestFurnace(this._baseCenter);
    console.log('[Building] Summary — table:' + hasTableNow + ' chest:' + hasChestNow +
      ' bed:' + hasBedNow + ' furnace:' + hasFurnaceNow);

    this._shelterBuilt = true;
    this._wallsUpgraded = false; // track separately — wood walls until upgraded

    if (!this._mainBasePos) {
      this._mainBasePos = center.clone();
      this._saveMainBase();
    }

    console.log('[Building] *** Base complete! ***');
    return true;
  }

  isUpgradedToStone() { return !!this._wallsUpgraded; }
  expansionCount()    { return this._expansions; }

  /**
   * Adds a new wing extending out from the existing base in a chosen
   * direction, rather than building a separate structure somewhere
   * else. Each call grows the "castle" by one room-sized section.
   * Requires stone (cobblestone) so expansions look and feel like a
   * castle being grown out of the original wooden core.
   */
  async expandBase() {
    if (!this._shelterBuilt || !this._baseCenter) {
      console.log('[Building] No base to expand yet');
      return false;
    }

    const material = this.inventory.count('cobblestone') >= 40 ? 'cobblestone' : this._bestPlankType();
    const have = this.inventory.count(material);
    const W = 5, D = 5, H = 3; // each wing is a bit smaller than the core room
    const needed = this._estimateMaterial(W, D, H);

    if (have < needed) {
      console.log('[Building] Not enough ' + material + ' to expand (' + have + '/' + needed + ')');
      return false;
    }

    // Pick the next direction in rotation: north, east, south, west —
    // so repeated expansions wrap the new wings around the original core
    // like a castle growing outward on each side.
    const directions = [
      { dx: 0, dz: -7 }, // north
      { dx: 7, dz: 0  }, // east
      { dx: 0, dz: 7  }, // south
      { dx: -7, dz: 0 }, // west
    ];
    const dir = directions[this._expansions % directions.length];
    const wingCenter = this._baseCenter.offset(dir.dx, 0, dir.dz);
    const origin = wingCenter.offset(-Math.floor(W/2), 0, -Math.floor(D/2));

    console.log('[Building] Expanding base — wing #' + (this._expansions + 1) +
      ' at ' + wingCenter.x + ',' + wingCenter.y + ',' + wingCenter.z + ' using ' + material);

    for (let x = 0; x < W; x++)
      for (let z = 0; z < D; z++)
        await this._place(origin.offset(x, -1, z), material);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        for (let z = 0; z < D; z++) {
          const isWall = x===0 || x===W-1 || z===0 || z===D-1;
          if (!isWall) continue;
          // Doorway facing back toward the main base
          const facingMain = dir.dz < 0 ? (z===D-1 && x===Math.floor(W/2) && y<2)
                            : dir.dz > 0 ? (z===0 && x===Math.floor(W/2) && y<2)
                            : dir.dx < 0 ? (x===W-1 && z===Math.floor(D/2) && y<2)
                            : (x===0 && z===Math.floor(D/2) && y<2);
          if (facingMain) continue;
          await this._place(origin.offset(x, y, z), material);
        }
      }
    }

    for (let x = 0; x < W; x++)
      for (let z = 0; z < D; z++)
        await this._place(origin.offset(x, H, z), material);

    this._expansions++;
    this._saveMainBase();
    console.log('[Building] *** Wing #' + this._expansions + ' complete — base is growing! ***');
    return true;
  }

  /**
   * Replace the wooden walls of the existing shelter with cobblestone,
   * one block at a time, without touching the floor/roof/door/furniture.
   * Requires the shelter to already be built and the bot to be carrying
   * enough cobblestone.
   */
  async upgradeWallsToStone() {
    if (!this._shelterBuilt || !this._baseCenter) {
      console.log('[Building] No shelter to upgrade yet');
      return false;
    }
    if (this._wallsUpgraded) return true;

    const W = 6, D = 6, H = 3; // must match buildShelter's dimensions
    const origin = this._baseCenter.offset(-Math.floor(W/2), 0, -Math.floor(D/2));
    const needed = (2*(W+D)-4) * H; // walls only, not floor/roof
    const have = this.inventory.count('cobblestone');

    console.log('[Building] Upgrading walls to stone — have ' + have + ', need ~' + needed);
    if (have < needed) {
      console.log('[Building] Not enough cobblestone to upgrade yet');
      return false;
    }

    let replaced = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        for (let z = 0; z < D; z++) {
          const isWall = x===0 || x===W-1 || z===0 || z===D-1;
          if (!isWall) continue;
          if (z===0 && x===Math.floor(W/2) && y<2) continue; // door gap
          if (y===1 && (x===0||x===W-1) && z===Math.floor(D/2)) continue; // window gap

          const pos = origin.offset(x, y, z);
          const block = this.bot.blockAt(pos);
          if (!block) continue;
          // Skip blocks that aren't the wood wall (door, torch, chest, bed, etc.)
          if (!['oak_planks','birch_planks','spruce_planks','dark_oak_planks',
                'jungle_planks','acacia_planks'].includes(block.name)) continue;

          try {
            await this.navigation.moveTo(pos, 4);
            await this.bot.dig(block);
            await this._place(pos, 'cobblestone');
            replaced++;
          } catch(e) {
            console.warn('[Building] Wall upgrade step failed:', e.message);
          }
        }
      }
    }

    console.log('[Building] Replaced ' + replaced + ' wall blocks with stone');
    if (replaced > 0) {
      this._wallsUpgraded = true;
      console.log('[Building] *** Walls upgraded to stone! ***');
    }
    return this._wallsUpgraded;
  }

  async _ensureCraftingTableAt(pos) {
    try {
      let item = this.inventory.getItem('crafting_table');
      if (!item) {
        // Craft one from planks if we don't have one
        const plankType = this._bestPlankType();
        const id = this.bot.registry.itemsByName['crafting_table']?.id;
        if (id && this.inventory.count(plankType) >= 4) {
          const recipes = this.bot.recipesFor(id, null, 1, null);
          if (recipes.length) await this.bot.craft(recipes[0], 1, null);
        }
        item = this.inventory.getItem('crafting_table');
      }
      if (!item) return false;

      const ground = this.bot.blockAt(pos.offset(0, -1, 0));
      const above = this.bot.blockAt(pos);
      if (!ground || ground.boundingBox !== 'block') return false;
      if (['water','flowing_water','lava','flowing_lava'].includes(ground.name)) return false;
      if (above && above.name !== 'air') {
        try { await this.bot.dig(above); } catch(e) {}
      }
      await this.navigation.moveTo(pos, 3);
      await this.bot.equip(item, 'hand');
      await this.bot.placeBlock(ground, new Vec3(0, 1, 0));
      console.log('[Building] Crafting table placed inside shelter');
      return true;
    } catch(e) {
      console.warn('[Building] Could not place crafting table inside:', e.message);
      return false;
    }
  }

  async _placeChestInside(origin, W, D) {
    let chestItem = this.inventory.getItem('chest');
    if (!chestItem) return;

    // Use a corner away from the centered table — works for any W/D >= 4
    const chestPos = origin.offset(1, 0, 1);
    try {
      const ground = this.bot.blockAt(chestPos.offset(0,-1,0));
      if (!ground || ground.boundingBox !== 'block') return;
      const above = this.bot.blockAt(chestPos);
      if (above && above.name !== 'air') return;

      await this.navigation.moveTo(chestPos, 3);
      await this.bot.equip(chestItem, 'hand');
      await this.bot.placeBlock(ground, new Vec3(0,1,0));
      const placed = this.bot.blockAt(chestPos);
      if (placed?.name === 'chest') {
        this.memory.addChest(chestPos, 'general');
        console.log('[Building] Chest placed inside base');
      }
    } catch(e) {
      console.warn('[Building] Chest placement failed:', e.message);
    }
  }

  async _placeBedInside(origin, W, D) {
    const bedTypes = ['white_bed','red_bed','blue_bed','green_bed','yellow_bed',
                      'black_bed','brown_bed','cyan_bed','gray_bed','light_blue_bed',
                      'lime_bed','magenta_bed','orange_bed','pink_bed','purple_bed','light_gray_bed'];
    let bedItem = null;
    for (const b of bedTypes) {
      bedItem = this.inventory.getItem(b);
      if (bedItem) break;
    }
    if (!bedItem) return;

    const bedPos = origin.offset(W-2, 0, 1);
    try {
      const ground = this.bot.blockAt(bedPos.offset(0,-1,0));
      if (!ground || ground.boundingBox !== 'block') return;
      await this.navigation.moveTo(bedPos, 3);
      await this.bot.equip(bedItem, 'hand');
      await this.bot.placeBlock(ground, new Vec3(0,1,0));
      console.log('[Building] Bed placed inside base');
      this.memory.bedLocation = bedPos.clone();
    } catch(e) {
      console.warn('[Building] Bed placement failed:', e.message);
    }
  }

  async _placeFurnaceInside(origin, W, D) {
    let furnaceItem = this.inventory.getItem('furnace');
    if (!furnaceItem) return;

    // Distinct corner from table (center), chest (1,1), and bed (W-2,1).
    // Works for any room >= 5x5; for a 6x6 this lands at (1, 0, W-2).
    const furnacePos = origin.offset(1, 0, D-2);
    try {
      const ground = this.bot.blockAt(furnacePos.offset(0,-1,0));
      if (!ground || ground.boundingBox !== 'block') return;
      const above = this.bot.blockAt(furnacePos);
      if (above && above.name !== 'air') return;

      await this.navigation.moveTo(furnacePos, 3);
      await this.bot.equip(furnaceItem, 'hand');
      await this.bot.placeBlock(ground, new Vec3(0,1,0));
      const placed = this.bot.blockAt(furnacePos);
      if (placed?.name === 'furnace') {
        this.memory.addFurnace(furnacePos);
        console.log('[Building] Furnace placed inside base');
      }
    } catch(e) {
      console.warn('[Building] Furnace placement failed:', e.message);
    }
  }

  // ── emergency shelter (any material, fast) ─────────────────

  async buildEmergencyShelter() {
    console.log('[Building] Emergency shelter!');
    const materials = ['oak_planks','birch_planks','spruce_planks','cobblestone','dirt','sand'];
    let mat = null;
    for (const m of materials) {
      if (this.inventory.has(m, 12)) { mat = m; break; }
    }
    if (!mat) return false;

    const pos  = this.bot.entity.position.floored();
    const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

    for (let y = 0; y < 3; y++) {
      for (const [dx,dz] of dirs) {
        await this._place(pos.offset(dx,y,dz), mat);
      }
    }
    for (let dx=-1; dx<=1; dx++)
      for (let dz=-1; dz<=1; dz++)
        await this._place(pos.offset(dx,3,dz), mat);

    console.log('[Building] Emergency shelter done');
    return true;
  }

  // ── block placement ─────────────────────────────────────────

  async _place(pos, blockName) {
    try {
      const existing = this.bot.blockAt(pos);
      if (existing && existing.name === blockName) return true;
      if (existing && existing.name !== 'air') return false;

      const item = this.inventory.getItem(blockName);
      if (!item) return false;

      const offsets = [
        new Vec3(0,-1,0), new Vec3(0,1,0),
        new Vec3(1,0,0),  new Vec3(-1,0,0),
        new Vec3(0,0,1),  new Vec3(0,0,-1),
      ];

      for (const off of offsets) {
        const ref = this.bot.blockAt(pos.plus(off));
        if (!ref || ref.boundingBox !== 'block' || ref.name === 'air') continue;

        await this.navigation.moveTo(pos, 4);
        await this.bot.equip(item, 'hand');
        await this.bot.placeBlock(ref, off.scaled(-1));
        return true;
      }
    } catch(e) {}
    return false;
  }

  _estimateMaterial(w, d, h) {
    const walls   = (2*(w+d)-4) * h;
    const floor   = w * d;
    const ceiling = w * d;
    return walls + floor + ceiling;
  }
}

module.exports = BuildingSystem;
