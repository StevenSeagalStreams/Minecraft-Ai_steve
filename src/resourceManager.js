"use strict";

const TOOL_FOR_BLOCK = {
  log: "axe",
  planks: "axe",
  stone: "pickaxe",
  cobblestone: "pickaxe",
  ore: "pickaxe",
  deepslate: "pickaxe",
};

function toolTypeForBlock(blockName) {
  if (blockName.includes("log")) return "axe";
  if (blockName.includes("ore") || blockName.includes("stone") || blockName.includes("deepslate")) {
    return "pickaxe";
  }
  return null;
}

/**
 * Handles locating and gathering raw resources: wood, stone and ores.
 * Falls back to manual dig+navigate logic so it works even without the
 * collectblock plugin installed.
 */
class ResourceManager {
  constructor(bot, perception, navigation, inventory, memory) {
    this.bot = bot;
    this.perception = perception;
    this.navigation = navigation;
    this.inventory = inventory;
    this.memory = memory;
  }

  /** Mines a single target block, equipping the right tool first. */
  async mineBlock(block) {
    if (!block) return false;
    const toolType = toolTypeForBlock(block.name);
    if (toolType) {
      await this.inventory.equipBestTool(toolType).catch(() => null);
    }

    try {
      await this.navigation.goNearBlock(block, 2);
    } catch (err) {
      return false;
    }

    // Re-fetch the block in case the world changed since the scan.
    const freshBlock = this.bot.blockAt(block.position);
    if (!freshBlock || freshBlock.name === "air") return false;

    try {
      await this.bot.dig(freshBlock);
      this.memory.incrementStat("blocksMined");
      return true;
    } catch (err) {
      return false;
    }
  }

  async gatherWood(targetCount = 8) {
    let collected = 0;
    while (collected < targetCount) {
      const blocks = this.perception.findBlocks(
        require("./perception").WOOD_BLOCKS,
        32
      );
      if (blocks.length === 0) {
        const remembered = this.memory.getNearestResource(
          "wood",
          this.bot.entity.position
        );
        if (remembered) {
          try {
            await this.navigation.goTo(remembered, { range: 5 });
            continue;
          } catch (_) {
            return collected; // can't reach remembered location either
          }
        }
        return collected; // no wood found nearby
      }
      const target = blocks[0];
      this.memory.remember("wood", target.position);
      const ok = await this.mineBlock(target);
      if (ok) collected++;
      else break;
    }
    return collected;
  }

  async gatherStone(targetCount = 16) {
    let collected = 0;
    while (collected < targetCount) {
      const blocks = this.perception.findBlocks(
        require("./perception").STONE_BLOCKS,
        32
      );
      if (blocks.length === 0) return collected;
      const target = blocks[0];
      this.memory.remember("stone", target.position);
      const ok = await this.mineBlock(target);
      if (ok) collected++;
      else break;
    }
    return collected;
  }

  async gatherOre(oreType, targetCount = 4) {
    let collected = 0;
    const oreSets = require("./perception").ORE_BLOCKS;
    const nameSet = oreSets[oreType];
    if (!nameSet) return 0;

    while (collected < targetCount) {
      const blocks = this.perception.findBlocks(nameSet, 32);
      if (blocks.length === 0) return collected;
      const target = blocks[0];
      this.memory.remember(oreType, target.position);
      const ok = await this.mineBlock(target);
      if (ok) collected++;
      else break;
    }
    return collected;
  }

  /** Picks up any nearby dropped items (e.g. after mining). */
  async collectNearbyItems(radius = 8) {
    const items = this.perception.getNearbyItems(radius);
    for (const item of items) {
      try {
        await this.navigation.goTo(item.position, { range: 1, timeoutMs: 8000 });
      } catch (_) {
        // skip unreachable item
      }
    }
  }
}

module.exports = ResourceManager;
