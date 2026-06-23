// ============================================================
// config.js — Central configuration for the autonomous bot
// ============================================================

module.exports = {
  // --- Connection ---
  bot: {
    host: process.env.MC_HOST || 'localhost',
    port: parseInt(process.env.MC_PORT) || 25565,
    username: process.env.MC_USERNAME || 'AutonomousBot',
    auth: process.env.MC_AUTH || 'offline',  // 'microsoft' for online-mode
    version: process.env.MC_VERSION || false, // false = auto-detect
  },

  // --- Survival thresholds ---
  survival: {
    lowHealthThreshold: 8,        // hearts (out of 20)
    criticalHealthThreshold: 4,
    hungerThreshold: 14,          // food points (eat when below this)
    criticalHungerThreshold: 6,
  },

  // --- Inventory ---
  inventory: {
    fullThreshold: 32,            // slots used before considered "full"
    keepItems: [                  // items never deposited to chest
      'crafting_table',
      'furnace',
      'torch',
      'wooden_pickaxe',
      'stone_pickaxe',
      'iron_pickaxe',
      'wooden_sword',
      'stone_sword',
      'iron_sword',
      'wooden_axe',
      'stone_axe',
      'cooked_beef',
      'cooked_porkchop',
      'bread',
      'apple',
    ],
    foodItems: [
      'cooked_beef', 'cooked_porkchop', 'cooked_chicken',
      'cooked_mutton', 'cooked_rabbit', 'cooked_cod',
      'cooked_salmon', 'bread', 'apple', 'carrot',
      'baked_potato', 'pumpkin_pie',
    ],
  },

  // --- Gathering ---
  gathering: {
    maxSearchRadius: 64,
    woodTypes: [
      'oak_log', 'birch_log', 'spruce_log',
      'jungle_log', 'acacia_log', 'dark_oak_log',
    ],
    stoneTypes: ['stone', 'cobblestone', 'deepslate'],
    oreTypes: [
      'iron_ore', 'deepslate_iron_ore',
      'coal_ore', 'deepslate_coal_ore',
      'gold_ore', 'deepslate_gold_ore',
      'diamond_ore', 'deepslate_diamond_ore',
    ],
    minWoodInInventory: 10,   // gather more wood if below this
    minStoneInInventory: 16,
    minCoalInInventory: 8,
  },

  // --- Combat ---
  combat: {
    attackRange: 3.5,
    fleeHealthThreshold: 6,
    hostileMobs: [
      'zombie', 'skeleton', 'spider', 'creeper', 'enderman',
      'witch', 'pillager', 'vindicator', 'phantom', 'drowned',
      'husk', 'stray', 'blaze', 'ghast', 'cave_spider',
      'silverfish', 'slime', 'magma_cube',
    ],
    passiveMobs: [
      'cow', 'pig', 'sheep', 'chicken', 'rabbit', 'cod', 'salmon',
    ],
  },

  // --- Building ---
  building: {
    shelterSize: { width: 7, depth: 5, height: 4 },
    shelterMaterial: 'cobblestone',
    shelterRadius: 50,            // build within this radius of base
  },

  // --- Navigation ---
  navigation: {
    stuckTimeout: 10000,          // ms before considering bot stuck
    stuckDistance: 1.5,           // blocks — if moved less, consider stuck
    defaultMoveSpeed: 1,
  },

  // --- State machine ---
  stateMachine: {
    tickInterval: 1000,           // ms between decision ticks
    exploreStepDistance: 32,      // blocks to walk per explore step
  },

  // --- Progression tiers ---
  progression: {
    tiers: ['wood', 'stone', 'iron', 'diamond'],
    tierRequirements: {
      wood:    { wood_planks: 7 },
      stone:   { cobblestone: 11, stick: 4 },
      iron:    { iron_ingot: 11, stick: 4 },
      diamond: { diamond: 11, stick: 4 },
    },
  },
};
