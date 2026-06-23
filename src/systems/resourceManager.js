"use strict";

const { WOOD_BLOCKS, STONE_BLOCKS, ORE_BLOCKS } = require("../perception/perception");
const MODULE = "Resource";

function toolFor(blockName) {
  if (!blockName) return null;
  if (blockName.includes("log"))  return "axe";
  if (blockName.includes("ore") || blockName.includes("stone") || blockName.includes("cobblestone") || blockName.includes("deepslate")) return "pickaxe";
  if (blockName.includes("dirt") || blockName.includes("gravel") || blockName.includes("sand")) return "shovel";
  return null;
}

/**
 * Responsible for gathering raw materials: wood, stone, ores, and food.
 * Works with the bot's recipe graph so it knows which pickaxe tier
 * is required for each ore (no wasted silk-touch trips).
 */
class ResourceManager {
  constructor(bot, perception, navigation, inventory, memory, logger, eventBus) {
    this.bot        = bot;
    this.perception = perception;
    this.navigation = navigation;
    this.inventory  = inventory;
    this.memory     = memory;
    this.logger     = logger;
    this.eventBus   = eventBus;
  }

  // ─── Generic block mining ─────────────────────────────────────────────────

  async mineBlock(block) {
    if (!block) return false;
    const tool = toolFor(block.name);
    if (tool) await this.inventory.equipBestTool(tool).catch(() => null);

    try {
      await this.navigation.goToBlock(block, 2);
    } catch (_) {
      return false;
    }

    const fresh = this.bot.blockAt(block.position);
    if (!fresh || fresh.name === "air") return false;

    try {
      await this.bot.dig(fresh);
      this.memory.increment("blocksMined");
      return true;
    } catch (err) {
      this.logger.debug(MODULE, `Dig failed: ${err.message}`);
      return false;
    }
  }

  async mineBlockAt(position) {
    const block = this.bot.blockAt(position);
    if (!block || block.name === "air") return false;
    return this.mineBlock(block);
  }

  // ─── Wood ─────────────────────────────────────────────────────────────────

  async gatherWood(target = 8) {
    let collected = 0;
    let attempts  = 0;
    this.logger.info(MODULE, `Gathering ${target} wood logs`);

    while (collected < target && attempts < target * 3) {
      attempts++;
      const blocks = this.perception.findBlocks
        ? this.perception.findBlocks(WOOD_BLOCKS, 48, 8)
        : this.perception.last?.woodBlocks ?? [];

      if (!blocks.length) {
        this.logger.warn(MODULE, "No wood found nearby; exploring");
        await this.navigation.exploreRandomly(this.bot.entity.position, 64);
        continue;
      }

      const target_block = blocks[0];
      this.memory.rememberResource("wood", target_block.position);
      const ok = await this.mineBlock(target_block);
      if (ok) collected++;
    }

    await this._collectDrops();
    this.logger.info(MODULE, `Collected ${collected} wood logs`);
    return collected;
  }

  // ─── Stone ────────────────────────────────────────────────────────────────

  async gatherStone(target = 16) {
    let collected = 0;
    this.logger.info(MODULE, `Gathering ${target} stone blocks`);

    while (collected < target) {
      const snap   = this.perception.last;
      const blocks = snap?.stoneBlocks ?? this._findBlocks(STONE_BLOCKS, 32);
      if (!blocks.length) break;

      const ok = await this.mineBlock(blocks[0]);
      if (ok) collected++;
      else break;
    }
    await this._collectDrops();
    return collected;
  }

  // ─── Ores ────────────────────────────────────────────────────────────────

  async gatherOre(oreType, target = 4) {
    const oreSet = ORE_BLOCKS[oreType];
    if (!oreSet) return 0;
    let collected = 0;
    this.logger.info(MODULE, `Gathering ${target} ${oreType} ore`);

    while (collected < target) {
      const blocks = this._findBlocks(oreSet, 32);
      if (!blocks.length) {
        // Check if we have a remembered location
        const rem = this.memory.getNearestResource(oreType, this.bot.entity.position);
        if (rem) {
          await this.navigation.goTo(rem, { range: 8 }).catch(() => null);
          continue;
        }
        break;
      }
      this.memory.rememberResource(oreType, blocks[0].position);
      const ok = await this.mineBlock(blocks[0]);
      if (ok) collected++;
      else break;
    }
    await this._collectDrops();
    return collected;
  }

  // ─── Food gathering ───────────────────────────────────────────────────────

  async huntPassiveMob() {
    const snap = this.perception.last;
    if (!snap || !snap.passiveMobs.length) return false;

    const mob = snap.passiveMobs[0];
    this.logger.info(MODULE, `Hunting ${mob.name}`);
    await this.inventory.equipBestTool("sword");

    for (let i = 0; i < 20 && mob.entity.isValid !== false; i++) {
      const dist = mob.entity.position.distanceTo(this.bot.entity.position);
      if (dist > 3) {
        try {
          await this.navigation.goToBlock({ position: mob.entity.position }, 2, 5000);
        } catch (_) {}
      } else {
        this.bot.lookAt(mob.entity.position.offset(0, mob.entity.height ?? 1, 0));
        try { this.bot.attack(mob.entity); } catch (_) {}
        await this._sleep(600);
      }
    }
    await this._collectDropps(8);
    return true;
  }

  async cookRawFood() {
    const rawFoods = ["beef","porkchop","chicken","mutton","cod","salmon","potato"];
    for (const raw of rawFoods) {
      const count = this.inventory.countOf(raw);
      if (count > 0) return { item: raw, count };
    }
    return null;
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  _findBlocks(nameSet, radius = 32, maxCount = 8) {
    const positions = this.bot.findBlocks({
      matching: (b) => b && nameSet.has(b.name),
      maxDistance: radius,
      count: maxCount,
    });
    return positions.map((p) => this.bot.blockAt(p)).filter(Boolean);
  }

  async _collectDrops(radius = 8) {
    const drops = Object.values(this.bot.entities).filter(
      (e) => e.type === "object" &&
        e.objectType === "Item" &&
        e.position?.distanceTo(this.bot.entity.position) <= radius
    );
    for (const drop of drops) {
      try { await this.navigation.goTo(drop.position, { range: 1, timeoutMs: 5000 }); } catch (_) {}
    }
  }

  _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
}

module.exports = ResourceManager;
