// Central runtime configuration for the bot.
// Override any of these via environment variables.
module.exports = {
  host: process.env.MC_HOST || "localhost",
  port: Number(process.env.MC_PORT || 25565),
  username: process.env.MC_USERNAME || "AiSteve",
  password: process.env.MC_PASSWORD || undefined,
  auth: process.env.MC_AUTH || "offline", // "offline" | "microsoft"
  version: process.env.MC_VERSION || undefined, // auto-detect if undefined

  // Tuning knobs used across subsystems
  lowHealthThreshold: 8, // out of 20
  hungerThreshold: 14, // out of 20
  criticalHealthThreshold: 5,
  inventoryFullThreshold: 0.9, // fraction of slots used
  nightStartTime: 13000, // minecraft tick when mobs start spawning
  nightEndTime: 23000,
  combatEngageRange: 10,
  fleeHealthThreshold: 6,
  tickIntervalMs: 1000,
};
