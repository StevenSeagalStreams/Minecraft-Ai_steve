"use strict";

/**
 * Mob data table: each entry defines engagement rules, threat level,
 * loot value and special combat notes.
 *
 * threatLevel 1-10  (10 = most dangerous)
 * engagePolicy: always | equipped | avoid | run
 */
const HOSTILE_MOB_DATA = {
  zombie:         { threatLevel: 2, maxHealth: 20, loot: ["rotten_flesh"],         engagePolicy: "always",   notes: "" },
  zombie_villager:{ threatLevel: 2, maxHealth: 20, loot: ["rotten_flesh"],         engagePolicy: "always",   notes: "" },
  skeleton:       { threatLevel: 4, maxHealth: 20, loot: ["arrow","bone"],          engagePolicy: "equipped", notes: "ranged; use cover" },
  stray:          { threatLevel: 4, maxHealth: 20, loot: ["arrow","bone"],          engagePolicy: "equipped", notes: "slowness arrows" },
  spider:         { threatLevel: 3, maxHealth: 16, loot: ["string","spider_eye"],   engagePolicy: "always",   notes: "jumpy" },
  cave_spider:    { threatLevel: 4, maxHealth: 12, loot: ["string","spider_eye"],   engagePolicy: "equipped", notes: "poison; avoid caves without milk" },
  creeper:        { threatLevel: 6, maxHealth: 20, loot: ["gunpowder"],             engagePolicy: "equipped", notes: "keep >6 blocks; NEVER in cave" },
  enderman:       { threatLevel: 5, maxHealth: 40, loot: ["ender_pearl"],           engagePolicy: "equipped", notes: "avoid eye contact; water kills it" },
  witch:          { threatLevel: 7, maxHealth: 26, loot: ["potion","redstone"],     engagePolicy: "equipped", notes: "high threat; potions" },
  drowned:        { threatLevel: 3, maxHealth: 20, loot: ["rotten_flesh","copper"], engagePolicy: "always",   notes: "has trident variant" },
  husk:           { threatLevel: 3, maxHealth: 20, loot: ["rotten_flesh"],          engagePolicy: "always",   notes: "hunger debuff" },
  phantom:        { threatLevel: 4, maxHealth: 20, loot: ["phantom_membrane"],      engagePolicy: "equipped", notes: "only at night; sleep to prevent" },
  pillager:       { threatLevel: 5, maxHealth: 24, loot: ["arrow","crossbow"],      engagePolicy: "equipped", notes: "raid trigger" },
  vindicator:     { threatLevel: 7, maxHealth: 24, loot: ["emerald"],               engagePolicy: "equipped", notes: "very high damage" },
  evoker:         { threatLevel: 8, maxHealth: 24, loot: ["totem_of_undying"],      engagePolicy: "equipped", notes: "summons vex" },
  vex:            { threatLevel: 5, maxHealth: 14, loot: [],                        engagePolicy: "equipped", notes: "phases through walls" },
  slime:          { threatLevel: 2, maxHealth: 16, loot: ["slime_ball"],            engagePolicy: "always",   notes: "splits" },
  magma_cube:     { threatLevel: 3, maxHealth: 16, loot: ["magma_cream"],           engagePolicy: "equipped", notes: "fire immune" },
  blaze:          { threatLevel: 6, maxHealth: 20, loot: ["blaze_rod"],             engagePolicy: "equipped", notes: "fire; ranged" },
  ghast:          { threatLevel: 5, maxHealth: 10, loot: ["ghast_tear","gunpowder"],engagePolicy: "equipped", notes: "deflect fireballs" },
  piglin:         { threatLevel: 3, maxHealth: 16, loot: ["gold_ingot"],            engagePolicy: "equipped", notes: "gold armor = neutral" },
  piglin_brute:   { threatLevel: 9, maxHealth: 50, loot: ["gold_ingot"],            engagePolicy: "avoid",    notes: "extremely dangerous" },
  hoglin:         { threatLevel: 6, maxHealth: 40, loot: ["porkchop","leather"],    engagePolicy: "equipped", notes: "knock-back; bring fire res" },
  zoglin:         { threatLevel: 7, maxHealth: 40, loot: ["rotten_flesh"],          engagePolicy: "avoid",    notes: "undead hoglin" },
  wither_skeleton:{ threatLevel: 8, maxHealth: 20, loot: ["bone","wither_skull"],   engagePolicy: "equipped", notes: "wither effect; find skull" },
  warden:         { threatLevel: 10,maxHealth: 500,loot: ["sculk_catalyst"],        engagePolicy: "run",      notes: "ALWAYS RUN. Never fight." },
  elder_guardian: { threatLevel: 9, maxHealth: 80, loot: ["sponge","prismarine"],   engagePolicy: "avoid",    notes: "mining fatigue debuff" },
  guardian:       { threatLevel: 5, maxHealth: 30, loot: ["prismarine","cod"],      engagePolicy: "equipped", notes: "" },
};

/**
 * Produces a threat score 0-100 for a mob entity in the current context.
 * Higher = more immediately dangerous.
 */
function classifyThreat(entity, bot) {
  const data = HOSTILE_MOB_DATA[entity.name];
  if (!data) return 0;

  const dist    = entity.position.distanceTo(bot.entity.position);
  const distPenalty = Math.max(0, 1 - dist / 20);   // closer = more threatening
  const baseThreat  = data.threatLevel * 10;
  const healthFactor = bot.health / 20;              // lower bot health = escalates
  const equipFactor  = _equipmentFactor(bot);        // better gear = less afraid

  let score = baseThreat * distPenalty * (1 + (1 - healthFactor)) * (1 / (equipFactor + 0.5));

  // Special case modifiers
  if (entity.name === "creeper" && dist < 4) score += 40;
  if (entity.name === "warden") score = 100;

  return Math.min(100, Math.round(score));
}

function _equipmentFactor(bot) {
  let score = 1;
  const tiers = { netherite: 5, diamond: 4, iron: 3, stone: 2, golden: 1.5, wooden: 1, leather: 0.8 };
  const slots = ["head","torso","legs","feet","hand"];
  for (const slot of slots) {
    const item = bot.inventory?.slots?.[bot.getEquipmentDestSlot?.(slot)];
    if (!item) continue;
    for (const [tier, val] of Object.entries(tiers)) {
      if (item.name.startsWith(tier)) { score += val; break; }
    }
  }
  return score;
}

/** Returns the engagement policy for a named mob. */
function shouldEngage(mobName, bot) {
  const data = HOSTILE_MOB_DATA[mobName];
  if (!data) return false;
  if (data.engagePolicy === "run" || data.engagePolicy === "avoid") return false;
  if (data.engagePolicy === "always") return true;
  if (data.engagePolicy === "equipped") return _equipmentFactor(bot) >= 3;
  return false;
}

module.exports = { HOSTILE_MOB_DATA, classifyThreat, shouldEngage };
