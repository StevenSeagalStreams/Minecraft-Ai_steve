// goalPlanner.js — Reactive goal system with robust crafting
const { Vec3 } = require('vec3');

class GoalPlanner {
  constructor(modules) {
    this.m = modules;
    this._activeGoalId   = null;
    this._activeTaskName = null;
    this._Recipe = null;
    console.log('[Planner] Loaded goal planner');
  }

  _getRecipe() {
    if (this._Recipe) return this._Recipe;
    const mcData = require('minecraft-data')(this.m.bot.version);
    this._Recipe = require('./node_modules/prismarine-recipe')(mcData).Recipe;
    return this._Recipe;
  }

  _count(n) { return this.m.inv.count(n); }

  _woodCount() {
    return ['oak_log','birch_log','spruce_log','dark_oak_log','jungle_log','acacia_log']
      .reduce((s,n) => s + this._count(n), 0);
  }

  _plankCount() {
    return ['oak_planks','birch_planks','spruce_planks','dark_oak_planks',
            'jungle_planks','acacia_planks','cherry_planks']
      .reduce((s,n) => s + this._count(n), 0);
  }

  hasPickaxe() {
    return ['wooden_pickaxe','stone_pickaxe','iron_pickaxe','diamond_pickaxe']
      .some(t => this.m.inv.has(t));
  }

  hasSword() {
    return ['wooden_sword','stone_sword','iron_sword','diamond_sword']
      .some(t => this.m.inv.has(t));
  }

  hasAxe() {
    return ['wooden_axe','stone_axe','iron_axe','diamond_axe']
      .some(t => this.m.inv.has(t));
  }

  // Checks if there's at least one solid, non-water/lava block within a
  // small radius that we could place something on top of.
  _hasFlatSpotNearby(pos) {
    const bot = this.m.bot;
    const offsets = [[1,0],[-1,0],[0,1],[0,-1],[2,0],[-2,0],[2,2],[-2,-2],[2,-2],[-2,2]];
    for (const [dx, dz] of offsets) {
      const tp = pos.offset(dx, 0, dz);
      const ground = bot.blockAt(tp.offset(0, -1, 0));
      const above  = bot.blockAt(tp);
      if (!ground || ground.boundingBox !== 'block') continue;
      if (['water','flowing_water','lava','flowing_lava'].includes(ground.name)) continue;
      if (above && above.name !== 'air') continue;
      if (above && ['water','flowing_water'].includes(above.name)) continue;
      return true;
    }
    return false;
  }

  // Scans outward in a spiral for the nearest dry, solid ground position.
  // Returns a Vec3 to walk to, or null if nothing found within range.
  async _findDryLand(fromPos) {
    const bot = this.m.bot;
    const { Vec3 } = require('vec3');
    const maxRadius = 32;
    for (let r = 4; r <= maxRadius; r += 4) {
      for (let angle = 0; angle < 360; angle += 30) {
        const rad = angle * Math.PI / 180;
        const dx = Math.round(Math.cos(rad) * r);
        const dz = Math.round(Math.sin(rad) * r);
        const tp = fromPos.offset(dx, 0, dz);
        // Check a range of Y values since terrain may rise/fall
        for (let dy = -4; dy <= 4; dy++) {
          const checkPos = tp.offset(0, dy, 0);
          const ground = bot.blockAt(checkPos.offset(0, -1, 0));
          const here   = bot.blockAt(checkPos);
          if (!ground || ground.boundingBox !== 'block') continue;
          if (['water','flowing_water','lava','flowing_lava'].includes(ground.name)) continue;
          if (here && here.name !== 'air') continue;
          return checkPos;
        }
      }
    }
    return null;
  }

  _table() {
    const id = this.m.bot.registry.blocksByName['crafting_table'] &&
               this.m.bot.registry.blocksByName['crafting_table'].id;
    if (!id) return null;
    // Widened from 32 — gatherWood's search radius can now reach 160
    // blocks when wood is sparse, so the table needs to stay findable
    // even after the bot wanders that far while chopping trees.
    return this.m.bot.findBlock({ matching: id, maxDistance: 80 });
  }

  async _goToTable() {
    const t = this._table();
    if (!t) return null;
    await this.m.nav.moveTo(t.position, 2);
    const id = this.m.bot.registry.blocksByName['crafting_table'] &&
               this.m.bot.registry.blocksByName['crafting_table'].id;
    return this.m.bot.findBlock({ matching: id, maxDistance: 5 });
  }

  // The CORE craft function — finds a recipe we can actually execute
  async _craft(itemName, count) {
    count = count || 1;
    const m = this.m;
    const Recipe = this._getRecipe();
    const id = m.bot.registry.itemsByName[itemName] &&
               m.bot.registry.itemsByName[itemName].id;
    if (!id) { console.warn('[Planner] Unknown item:', itemName); return false; }

    const allRecipes = Recipe.find(id, null);
    if (!allRecipes || !allRecipes.length) {
      console.warn('[Planner] No recipes for', itemName);
      return false;
    }

    // Find a recipe where we have ALL required ingredients
    let chosen = null, needTable = false;
    for (const recipe of allRecipes) {
      const needed = {};
      for (const d of recipe.delta) {
        if (d.count < 0) {
          needed[d.id] = (needed[d.id] || 0) + Math.abs(d.count) * count;
        }
      }
      let ok = true;
      for (const ingId of Object.keys(needed)) {
        if (m.bot.inventory.count(parseInt(ingId), null) < needed[ingId]) {
          ok = false; break;
        }
      }
      if (ok) { chosen = recipe; needTable = recipe.requiresTable; break; }
    }

    if (!chosen) {
      console.warn('[Planner] Cannot craft', itemName, '— missing ingredients');
      return false;
    }

    let table = null;
    if (needTable) {
      table = await this._goToTable();
      if (!table) { console.warn('[Planner] Need crafting table but none found'); return false; }
    }

    try {
      await m.bot.craft(chosen, count, table);
      console.log('[Planner] Crafted ' + count + 'x ' + itemName);
      return true;
    } catch(e) {
      console.warn('[Planner] craft(' + itemName + '):', e.message);
      return false;
    }
  }

  // Convert logs to planks — picks the right plank type based on logs we have
  async _makePlanks(target) {
    target = target || 8;
    if (this._plankCount() >= target) return true;
    const logs = ['oak_log','birch_log','spruce_log','dark_oak_log','jungle_log','acacia_log'];
    for (const log of logs) {
      if (this._plankCount() >= target) break;
      const n = this.m.inv.count(log);
      if (!n) continue;
      const plank = log.replace('_log','_planks');
      const needed = Math.ceil((target - this._plankCount()) / 4);
      const batches = Math.min(n, needed);
      // Use _craft so it finds correct recipe for this log type
      await this._craft(plank, batches);
    }
    return this._plankCount() >= target;
  }

  // Many recipes (chest, door, etc.) require N planks of a SINGLE type —
  // _plankCount() sums across all types, which can pass the threshold
  // while no individual type has enough (e.g. 4 oak + 4 birch = 8 total,
  // but neither alone is enough for an 8-plank chest recipe). This finds
  // the plank type with the most stock and tops it up to the target by
  // converting more logs of that exact type, or crafting more of that
  // exact plank type from whatever matching logs remain.
  _plankTypes() {
    return ['oak_planks','birch_planks','spruce_planks','dark_oak_planks','jungle_planks','acacia_planks'];
  }

  _bestPlankType() {
    let best = null, bestCount = -1;
    for (const p of this._plankTypes()) {
      const c = this._count(p);
      if (c > bestCount) { bestCount = c; best = p; }
    }
    return { type: best, count: bestCount };
  }

  async _consolidatePlanks(target) {
    const { type, count } = this._bestPlankType();
    if (type && count >= target) return true; // already have enough of one type

    // Try to top up the leading type from matching logs first
    if (type) {
      const log = type.replace('_planks', '_log');
      const haveLogs = this._count(log);
      const need = Math.ceil((target - count) / 4);
      if (haveLogs >= need) {
        await this._craft(type, need);
        if (this._count(type) >= target) return true;
      }
    }

    // Not enough logs of the leading plank's type on hand — gather more
    // wood (any type) and try again with whatever ends up most plentiful.
    console.log('[Planner] Need ' + target + ' matching planks (have ' +
      (type || 'none') + ':' + Math.max(count, 0) + ') — gathering more wood');
    await this.m.resource.gatherWood(Math.max(8, target));

    const after = this._bestPlankType();
    if (after.type) {
      const log = after.type.replace('_planks', '_log');
      const haveLogs = this._count(log);
      const need = Math.ceil((target - after.count) / 4);
      if (haveLogs > 0) await this._craft(after.type, Math.min(haveLogs, need));
    }
    return this._bestPlankType().count >= target;
  }

  // Make sticks — always uses _craft so recipe matching works
  async _makeSticks(target) {
    target = target || 4;
    if (this._count('stick') >= target) return true;

    // Ensure planks first
    if (this._plankCount() < 2) {
      if (this._woodCount() < 1) {
        console.log('[Planner] No logs for sticks — gathering wood');
        await this.m.resource.gatherWood(8);
      }
      await this._makePlanks(4);
    }

    if (this._plankCount() < 2) {
      console.warn('[Planner] Still no planks for sticks');
      return false;
    }

    // Make sticks — use _craft which finds right recipe
    const batches = Math.ceil((target - this._count('stick')) / 4);
    await this._craft('stick', batches);
    return this._count('stick') >= target;
  }

  _goal(id, task, run) {
    return { id, taskName: task, run };
  }

  getActiveGoal() {
    const m = this.m;
    const self = this;

    // 1. Need wood? — target what's ACTUALLY needed (a handful of logs
    // for pickaxe+sword+axe sticks/planks), not a full 16. The mismatch
    // between calling gatherWood(16) while only needing 4 was wasting
    // enormous amounts of time chasing extra logs before the bot had
    // even a single weapon, which is exactly why nightfall kept catching
    // it unarmed.
    const needMaterial = this._woodCount() < 4 && this._plankCount() < 4 && this._count('stick') < 4;
    if (needMaterial) {
      return this._goal('get_wood', 'gather_wood', async function() {
        await m.resource.gatherWood(6);
        return self._woodCount() >= 4;
      });
    }

    // 2. Need planks?
    if (this._plankCount() < 4 && this._count('stick') < 4) {
      return this._goal('get_wood', 'make_planks', async function() {
        if (self._woodCount() < 1) await m.resource.gatherWood(8);
        await self._makePlanks(8);
        return self._plankCount() >= 4;
      });
    }

    // 3. Need crafting table? If we have a known base with a table that's
    // just out of immediate range, walk there instead of crafting/placing
    // a second table — that would scatter bases across the map every
    // time the bot wanders off. Only do this if nothing more urgent
    // (wood gathering, basic tool crafting) is pending — those don't
    // need a table and shouldn't be interrupted by a long walk home.
    if (!m.inv.has('crafting_table') && !this._table()) {
      const knownBase = m.memory.getBase();
      if (knownBase) {
        const distToBase = m.bot.entity.position.distanceTo(knownBase);
        if (distToBase > 32 && distToBase < 400) {
          return this._goal('setup', 'return_to_base', async function() {
            console.log('[Planner] Walking back to known base (' + Math.floor(distToBase) + ' blocks)');
            await m.nav.moveTo(knownBase, 5);
            return self._table() !== null;
          });
        }
      }
      return this._goal('setup', 'craft_crafting_table', async function() {
        if (self._plankCount() < 4) await self._makePlanks(8);
        return self._craft('crafting_table');
      });
    }

    // 4. Place crafting table?
    if (m.inv.has('crafting_table') && !this._table()) {
      return this._goal('setup', 'place_crafting_table', async function() {
        const item = m.inv.getItem('crafting_table');
        if (!item) return false;

        // Check if we're standing on/near water or otherwise bad ground
        const standingPos = m.bot.entity.position.floored();
        const standingGround = m.bot.blockAt(standingPos.offset(0, -1, 0));
        const onWater = standingGround && ['water','flowing_water','lava','flowing_lava'].includes(standingGround.name);

        if (onWater || !self._hasFlatSpotNearby(standingPos)) {
          console.log('[Planner] No good ground here — moving to find dry, flat land');
          const dryLand = await self._findDryLand(standingPos);
          if (dryLand) {
            await m.nav.moveTo(dryLand, 2);
          } else {
            // Couldn't find anything nearby — explore further and retry next tick
            await m.nav.exploreStep(20);
            return false;
          }
        }

        const pos = m.bot.entity.position.floored();
        for (const sp of [[1,0],[-1,0],[0,1],[0,-1],[2,0],[-2,0],[2,2],[-2,-2],[2,-2],[-2,2]]) {
          const tp = pos.offset(sp[0], 0, sp[1]);
          const ground = m.bot.blockAt(tp.offset(0,-1,0));
          const above  = m.bot.blockAt(tp);
          if (!ground || ground.boundingBox !== 'block') continue;
          // Explicitly reject water/lava as a base even if boundingBox check passes
          if (['water','flowing_water','lava','flowing_lava'].includes(ground.name)) continue;
          if (above && above.name !== 'air') continue;
          // Also reject if the placement spot itself is water (e.g. placing over a puddle)
          if (above && ['water','flowing_water'].includes(above.name)) continue;
          try {
            await m.bot.equip(item,'hand');
            await m.bot.placeBlock(ground, new Vec3(0,1,0));
            if (m.bot.blockAt(tp) && m.bot.blockAt(tp).name === 'crafting_table') {
              m.memory.addCraftingTable(tp);
              return true;
            }
          } catch(e) {}
        }
        return false;
      });
    }

    // 4.5 Place an early chest right next to the table — this is the
    // single most important survival fix: as soon as a chest exists,
    // material the bot gathers can be deposited and SURVIVES death,
    // instead of every death wiping out all progress back to zero.
    // Deliberately placed before tools/shelter so it happens as early
    // as possible in a fresh life.
    if (m.memory.getChests().length < 1) {
      if (!m.inv.has('chest')) {
        if (self._plankCount() < 8) {
          return this._goal('storage', 'get_planks_for_chest', async function() {
            if (self._woodCount() < 3) await m.resource.gatherWood(8);
            await self._consolidatePlanks(8);
            return self._plankCount() >= 8;
          });
        }
        return this._goal('storage', 'craft_early_chest', async function() {
          await self._consolidatePlanks(8);
          return self._craft('chest', 1);
        });
      }
      return this._goal('storage', 'place_early_chest', async function() {
        return await m.storage.placeChestNearTable();
      });
    }

    // 5. Need pickaxe?
    if (!this.hasPickaxe()) {
      return this._goal('tools', 'craft_pickaxe', async function() {
        // Make sure we have sticks and planks
        if (self._count('stick') < 2) await self._makeSticks(4);
        if (self._plankCount() < 3) await self._makePlanks(4);
        return (await self._craft('wooden_pickaxe')) ||
               (await self._craft('stone_pickaxe'))  ||
               (await self._craft('iron_pickaxe'));
      });
    }

    // 6. Need sword?
    if (!this.hasSword()) {
      return this._goal('tools', 'craft_sword', async function() {
        if (self._count('stick') < 1) await self._makeSticks(4);
        if (self._plankCount() < 2) await self._makePlanks(4);
        return (await self._craft('wooden_sword')) ||
               (await self._craft('stone_sword'))  ||
               (await self._craft('iron_sword'));
      });
    }

    // 6.5 Need axe? This was missing entirely before — without an axe
    // ever being crafted, _safeEquipAxe() in resourceManager has nothing
    // to switch to and the bot ends up chopping wood with whatever's in
    // hand (usually the sword), which is slower and looks wrong.
    if (!this.hasAxe()) {
      return this._goal('tools', 'craft_axe', async function() {
        if (self._count('stick') < 2) await self._makeSticks(4);
        if (self._plankCount() < 3) await self._makePlanks(4);
        return (await self._craft('wooden_axe')) ||
               (await self._craft('stone_axe'))  ||
               (await self._craft('iron_axe'));
      });
    }

    // 7. Build shelter — WOOD ONLY, TOP PRIORITY
    // Stone gathering was causing repeated drowning/lava deaths before any
    // shelter got built. A wooden shelter is faster and just as safe at night.
    if (!m.building.isShelterBuilt()) {
      // Need more wood for the larger 6x6 shelter — also covers extra
      // planks needed for the door, chest, and furnace below.
      if (this._woodCount() < 32) {
        return this._goal('shelter', 'gather_wood_shelter', async function() {
          await m.resource.gatherWood(36);
          return self._woodCount() >= 32;
        });
      }
      // Craft a real door before building so the entrance isn't just sealed planks
      const doorTypes = {
        oak_planks: 'oak_door', birch_planks: 'birch_door', spruce_planks: 'spruce_door',
        dark_oak_planks: 'dark_oak_door', jungle_planks: 'jungle_door', acacia_planks: 'acacia_door',
      };
      const hasAnyDoor = Object.values(doorTypes).some(d => m.inv.has(d));
      if (!hasAnyDoor && self._plankCount() >= 6) {
        return this._goal('shelter', 'craft_door', async function() {
          // Ensure 6+ planks of ONE type, then craft the matching door
          // for THAT type — crafting hardcoded 'oak_door' fails silently
          // forever if the bot consolidated a different plank type
          // (e.g. spruce), since oak_door only accepts oak_planks.
          await self._consolidatePlanks(6);
          const { type } = self._bestPlankType();
          const doorItem = doorTypes[type] || 'oak_door';
          return await self._craft(doorItem, 1);
        });
      }
      // Craft a chest BEFORE building — buildShelter only places a chest
      // if one is already in inventory. Without this step it silently
      // skips chest placement every single time.
      if (!m.inv.has('chest') && self._plankCount() >= 8) {
        return this._goal('shelter', 'craft_chest_for_base', async function() {
          await self._consolidatePlanks(8);
          const ok = await self._craft('chest', 1);
          if (!ok) console.warn('[Planner] Chest craft failed — likely fragmented plank types, gathering more wood of one type');
          return ok;
        });
      }
      // Craft a furnace too — needs cobblestone, so only attempt this if
      // we happen to have some already; otherwise skip and build without
      // it for now (the bot can place one later once it has stone tools).
      if (!m.inv.has('furnace') && self._count('cobblestone') >= 8) {
        return this._goal('shelter', 'craft_furnace_for_base', async function() {
          return await self._craft('furnace', 1);
        });
      }
      return this._goal('shelter', 'build_shelter', async function() {
        console.log('[Planner] *** BUILDING WOODEN SHELTER NOW ***');
        await m.building.buildShelter('wood');
        if (m.building.isShelterBuilt()) {
          console.log('[Planner] *** SHELTER COMPLETE ***');
          return true;
        }
        if (self._woodCount() < 24) {
          await m.resource.gatherWood(32);
        }
        return false;
      });
    }

    // 7.6 Upgrade shelter walls to stone once we have a base and some cobblestone
    if (m.building.isShelterBuilt() && !m.building.isUpgradedToStone()) {
      const neededForWalls = 48; // (2*(6+6)-4)*3 = 60, leave a little slack
      const haveNow   = this._count('cobblestone');
      const haveStash = m.storage.stashCount('cobblestone');

      if (haveNow < neededForWalls) {
        // Withdraw from chest first if we already stored enough there
        if (haveStash + haveNow >= neededForWalls) {
          return this._goal('upgrade', 'withdraw_stone', async function() {
            await m.storage.withdraw('cobblestone', neededForWalls - haveNow);
            return self._count('cobblestone') >= neededForWalls;
          });
        }
        return this._goal('upgrade', 'gather_stone_upgrade', async function() {
          if (!self.hasPickaxe()) return false; // tools goal below will handle this
          await m.resource.gatherStone(neededForWalls + 16);
          return self._count('cobblestone') >= neededForWalls;
        });
      }

      return this._goal('upgrade', 'upgrade_walls', async function() {
        return m.building.upgradeWallsToStone();
      });
    }

    // 7.7 Farming — establish a sustainable food source once the core
    // base and walls are sorted. This matters more than constantly
    // hunting animals (which requires combat/chasing and can fail).
    if (m.building.isShelterBuilt() && m.building.isUpgradedToStone() && !m.farming.hasFarm()) {
      if (!m.inv.has('wooden_hoe') && !m.inv.has('stone_hoe')) {
        return this._goal('farming', 'craft_hoe', async function() {
          if (self._plankCount() < 2) await self._makePlanks(4);
          return (await self._craft('wooden_hoe')) || (await self._craft('stone_hoe'));
        });
      }
      const hasSeeds = ['wheat_seeds','carrot','potato','beetroot_seeds'].some(s => m.inv.has(s));
      if (!hasSeeds) {
        // Seeds mainly come from breaking tall grass or finding crops in
        // the wild — fall through to normal exploration/goals until we
        // happen to pick some up, rather than blocking forever here.
      } else {
        return this._goal('farming', 'establish_farm', async function() {
          const base = m.building.getBaseCenter();
          if (!base) return false;
          return await m.farming.establishFarm(base, 5);
        });
      }
    }

    // 7.8 Harvest the farm periodically once it exists
    if (m.farming.hasFarm()) {
      return this._goal('farming', 'harvest_farm', async function() {
        const harvested = await m.farming.harvestFarm();
        return true; // always "succeeds" — nothing mature yet is fine
      });
    }

    // 7.9 Expand the base outward once it's stone-walled and stocked —
    // grows the original wooden core into a larger, castle-like
    // compound instead of building separate scattered structures.
    if (m.building.isShelterBuilt() && m.building.isUpgradedToStone()) {
      const haveStone = this._count('cobblestone');
      if (haveStone >= 60) {
        return this._goal('expand', 'expand_base', async function() {
          return await m.building.expandBase();
        });
      }
    }

    // 7.5 Need food and have none — go hunt/find some before continuing
    if (m.bot.food <= 8 && !m.inv.hasFood()) {
      return this._goal('survival', 'find_food', async function() {
        // 1. Cook any raw meat we're already carrying — fastest source
        const rawMeats = ['raw_beef','raw_porkchop','raw_chicken','raw_mutton','raw_rabbit'];
        for (const raw of rawMeats) {
          if (m.inv.count(raw) > 0) {
            const cooked = raw.replace('raw_', 'cooked_');
            const ok = await m.crafting.smelt(raw, cooked, m.inv.count(raw)).catch(() => false);
            if (ok || m.inv.hasFood()) return true;
          }
        }

        // 2. Look for nearby passive mobs across a wider radius
        const passiveNearby = m.perception.scanEntities(48).passive;
        if (passiveNearby.length > 0) {
          const hunted = await m.combat.huntPassiveMob().catch(() => false);
          if (hunted) return true;
        }

        // 3. Look for crops (wheat/carrot/potato) we can harvest directly
        const cropNames = ['wheat','carrots','potatoes','beetroots'];
        for (const crop of cropNames) {
          const id = m.bot.registry.blocksByName[crop]?.id;
          if (!id) continue;
          const block = m.bot.findBlock({ matching: id, maxDistance: 32 });
          if (block) {
            try {
              await m.nav.moveTo(block.position, 2);
              await m.bot.dig(block);
              if (m.inv.hasFood()) return true;
            } catch(e) {}
          }
        }

        // 4. Emergency fallback — eat rotten flesh from zombie kills if
        // we have any. It has a chance of giving food poisoning, but an
        // empty stomach leading to starvation/weakness mid-fight is far
        // worse, and the bot already accumulates this from combat for free.
        if (m.inv.count('rotten_flesh') > 0) {
          console.log('[Planner] No good food available — eating rotten flesh as last resort');
          try {
            const item = m.inv.getItem('rotten_flesh');
            if (item) {
              await m.bot.equip(item, 'hand');
              await m.bot.consume();
              return true;
            }
          } catch(e) {}
        }

        // 5. Nothing found nearby — explore further in a new direction
        await m.nav.exploreStep(40);
        return m.inv.hasFood();
      });
    }

    // 8. Stone tools?
    if (!m.inv.has('stone_pickaxe')) {
      if (this._count('cobblestone') < 10) {
        return this._goal('stone_tools', 'gather_stone', async function() {
          await m.resource.gatherStone(32);
          return self._count('cobblestone') >= 10;
        });
      }
      return this._goal('stone_tools', 'craft_stone_pickaxe', async function() {
        if (self._count('stick') < 2) await self._makeSticks(4);
        return self._craft('stone_pickaxe');
      });
    }

    if (!m.inv.has('stone_sword')) {
      return this._goal('stone_tools', 'craft_stone_sword', async function() {
        if (self._count('stick') < 1) await self._makeSticks(4);
        return self._craft('stone_sword');
      });
    }

    // 9. Coal + torches
    if (this._count('coal') < 8) {
      return this._goal('coal', 'gather_coal', async function() {
        await m.resource.gatherCoal(16);
        return self._count('coal') >= 8;
      });
    }
    if (this._count('torch') < 8) {
      return this._goal('coal', 'craft_torches', async function() {
        if (self._count('stick') < 1) await self._makeSticks(4);
        await self._craft('torch', 4);
        return true;
      });
    }

    // 10. Chest storage — initial setup if no chest exists yet
    if (m.memory.getChests().length < 1) {
      if (this._plankCount() < 8) {
        return this._goal('storage', 'get_planks', async function() {
          if (self._woodCount() < 3) await m.resource.gatherWood(8);
          await self._makePlanks(8);
          return self._plankCount() >= 8;
        });
      }
      if (!m.inv.has('chest')) {
        return this._goal('storage', 'craft_chest', async function() {
          return self._craft('chest');
        });
      }
      return this._goal('storage', 'deposit', async function() {
        await m.storage.depositItems();
        return true;
      });
    }

    // 10.5 Periodic deposit — once we have a chest, drop off excess
    // wood/stone whenever we're carrying a meaningful amount, so
    // progress survives death instead of being lost every single time.
    // Thresholds are intentionally low (25 wood, 15 stone) so material
    // gets banked early and often rather than waiting for a huge surplus.
    if (m.memory.getChests().length >= 1) {
      const excessWood  = this._woodCount() + this._plankCount() >= 25;
      const excessStone = this._count('cobblestone') >= 15;
      const nearBase = m.memory.getBase() &&
        m.bot.entity.position.distanceTo(m.memory.getBase()) < 40;

      if ((excessWood || excessStone) && nearBase) {
        return this._goal('storage', 'deposit_excess', async function() {
          console.log('[Planner] Banking materials in chest before continuing');
          await m.storage.depositItems();
          return true;
        });
      }
    }

    // 10.6 Craft armor once basic tools/shelter are sorted — extra
    // survivability matters more once the bot can already feed/house itself.
    const armorSlots = [
      ['helmet', 'iron_helmet', 'leather_helmet'],
      ['chestplate', 'iron_chestplate', 'leather_chestplate'],
      ['leggings', 'iron_leggings', 'leather_leggings'],
      ['boots', 'iron_boots', 'leather_boots'],
    ];
    for (const [slotName, ironPiece, leatherPiece] of armorSlots) {
      const hasIron    = m.inv.has(ironPiece);
      const hasLeather = m.inv.has(leatherPiece);
      if (hasIron || hasLeather) continue; // already has something for this slot

      // Prefer iron if we have ingots, otherwise leather if we have hide
      const ironOk    = self._count('iron_ingot') >= (slotName === 'chestplate' ? 8 : slotName === 'leggings' ? 7 : 5);
      const leatherOk = self._count('leather') >= (slotName === 'chestplate' ? 8 : slotName === 'leggings' ? 7 : 5);

      if (ironOk) {
        return this._goal('armor', 'craft_' + ironPiece, async function() {
          const ok = await self._craft(ironPiece);
          if (ok) await m.inv.equipArmorSlot(slotName);
          return ok;
        });
      }
      if (leatherOk) {
        return this._goal('armor', 'craft_' + leatherPiece, async function() {
          const ok = await self._craft(leatherPiece);
          if (ok) await m.inv.equipArmorSlot(slotName);
          return ok;
        });
      }
      // Don't have materials for this slot yet — move on to the next slot
      // rather than blocking on armor forever when iron/leather isn't available
    }

    // 11. Iron tools
    if (!m.inv.has('iron_pickaxe')) {
      if (this._count('raw_iron') + this._count('iron_ore') < 11) {
        return this._goal('iron', 'gather_iron', async function() {
          await m.resource.gatherIron(16);
          return true;
        });
      }
      if (!m.inv.has('furnace')) {
        return this._goal('iron', 'craft_furnace', async function() {
          return self._craft('furnace');
        });
      }
      if (this._count('iron_ingot') < 11) {
        return this._goal('iron', 'smelt_iron', async function() {
          const r = self._count('raw_iron');
          if (r > 0) await m.crafting.smelt('raw_iron','iron_ingot',Math.min(r,12));
          return true;
        });
      }
      return this._goal('iron', 'craft_iron_pickaxe', async function() {
        if (self._count('stick') < 2) await self._makeSticks(4);
        return self._craft('iron_pickaxe');
      });
    }

    if (!m.inv.has('iron_sword')) {
      return this._goal('iron', 'craft_iron_sword', async function() {
        if (self._count('stick') < 1) await self._makeSticks(4);
        return self._craft('iron_sword');
      });
    }

    return null;
  }

  async runNextTask(goal) {
    this._activeGoalId   = goal.id;
    this._activeTaskName = goal.taskName;
    console.log('[Planner] -> \'' + goal.taskName + '\' (' + goal.id + ')');
    try {
      const ok = await goal.run();
      if (ok) console.log('[Planner] done: ' + goal.taskName);
      else    console.log('[Planner] retry: ' + goal.taskName);
      return { done: false, taskName: goal.taskName, success: !!ok };
    } catch(e) {
      console.error('[Planner] error in \'' + goal.taskName + '\':', e.message);
      return { done: false, taskName: goal.taskName, success: false };
    }
  }

  status() {
    return {
      activeGoal: this._activeGoalId   || 'none',
      activeTask: this._activeTaskName || 'none',
      nextGoal: 'see logs', nextTask: 'see logs',
    };
  }
}

module.exports = { GoalPlanner };
