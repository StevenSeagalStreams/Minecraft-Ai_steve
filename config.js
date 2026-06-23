"use strict";

/**
 * Master configuration for AI Steve.
 * Every numeric threshold is exposed here so operators can tune
 * behaviour without touching any logic code.
 */
module.exports = {
  // ─── Connection ───────────────────────────────────────────────────────────
  host:     process.env.MC_HOST     || "localhost",
  port:     Number(process.env.MC_PORT || 25565),
  username: process.env.MC_USERNAME || "AiSteve",
  password: process.env.MC_PASSWORD || undefined,
  auth:     process.env.MC_AUTH     || "offline",   // "offline" | "microsoft"
  version:  process.env.MC_VERSION  || undefined,

  // ─── Logging ──────────────────────────────────────────────────────────────
  logLevel:    process.env.LOG_LEVEL    || "info",   // debug|info|warn|error
  logFile:     process.env.LOG_FILE     || "./data/aisteve.log",
  telemetryFile: process.env.TELEMETRY  || "./data/telemetry.jsonl",

  // ─── Persistence ──────────────────────────────────────────────────────────
  memoryFile:  process.env.MEMORY_FILE  || "./data/memory.json",
  saveInterval: 30000,   // ms between auto-saves

  // ─── Survival Thresholds ──────────────────────────────────────────────────
  health: {
    critical:     4,    // Flee immediately
    low:          8,    // Finish current action then retreat
    comfortable: 16,    // Below this, heal before new engagement
    full:        20,
  },
  hunger: {
    critical:     6,    // Stop everything and eat
    low:         12,    // Start looking for food
    comfortable: 18,
    full:        20,
  },

  // ─── Risk Thresholds ──────────────────────────────────────────────────────
  risk: {
    abort:     0.75,    // Risk score above this → abort task
    caution:   0.50,    // Above this → slow down, reassess
    acceptable: 0.30,
  },

  // ─── Combat ───────────────────────────────────────────────────────────────
  combat: {
    engageRange:     12,
    fleeRange:       20,
    safeDistance:    5,    // Melee comfort range
    maxMobsEngage:   3,    // Flee if more than N hostiles nearby
    kiteDistance:    7,    // Stay this far for ranged kiting
  },

  // ─── Navigation ───────────────────────────────────────────────────────────
  navigation: {
    defaultTimeout:    30000,
    longTimeout:       90000,
    stuckThreshold:    0.5,   // blocks moved per 3s before considered stuck
    stuckRetries:      3,
    fleeDistance:      20,
  },

  // ─── Inventory ────────────────────────────────────────────────────────────
  inventory: {
    fullThreshold: 0.85,        // fraction of slots before depositing
    criticalFull:  0.95,        // above this, drop lowest-priority items
    reserveSlots:  4,           // always keep N slots free for pickups
  },

  // ─── Resource Reserves ────────────────────────────────────────────────────
  reserves: {
    food:        16,
    wood:        32,
    stone:       64,
    coal:        16,
    iron:        16,
    torches:     32,
    buildBlocks: 128,
  },

  // ─── Base Building ────────────────────────────────────────────────────────
  base: {
    shelterSize:   5,
    expandTrigger: 0.8,    // Storage fullness that triggers expansion
  },

  // ─── Exploration ──────────────────────────────────────────────────────────
  exploration: {
    maxDistanceFromBase: 1000,
    chunkRadius:         2,
    nightVentureDist:    16,   // Only go this far from base at night
  },

  // ─── Death Recovery ───────────────────────────────────────────────────────
  recovery: {
    despawnSeconds:   300,     // Item despawn time in seconds
    minRetrieveChance: 0.40,   // Minimum probability to attempt retrieval
    gearUpBeforeReturn: true,
  },

  // ─── GOAP ─────────────────────────────────────────────────────────────────
  goap: {
    maxPlanDepth: 20,
    planTimeoutMs: 5000,
  },

  // ─── Tick Loop ────────────────────────────────────────────────────────────
  tickIntervalMs: 500,          // Main loop frequency
  perceptionIntervalMs: 1000,   // How often to do a full world scan
};
