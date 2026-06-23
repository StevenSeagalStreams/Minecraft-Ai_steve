"use strict";

/**
 * Static crafting dependency graph.
 *
 * Each node: { requires: {item: count}, needsTable: bool, neededFor: [] }
 * The planner walks this graph bottom-up to figure out what raw materials
 * are needed to reach any target item.
 *
 * Smelting recipes are in SMELT_RECIPES (input → output, fuel).
 */

const CRAFTING_RECIPES = {
  // ─── Wood chain ─────────────────────────────────────────────────────
  oak_planks:       { requires: { oak_log: 1 },                                              needsTable: false, yields: 4 },
  stick:            { requires: { oak_planks: 2 },                                            needsTable: false, yields: 4 },
  crafting_table:   { requires: { oak_planks: 4 },                                            needsTable: false, yields: 1 },
  wooden_pickaxe:   { requires: { oak_planks: 3, stick: 2 },                                  needsTable: true,  yields: 1 },
  wooden_axe:       { requires: { oak_planks: 3, stick: 2 },                                  needsTable: true,  yields: 1 },
  wooden_sword:     { requires: { oak_planks: 2, stick: 1 },                                  needsTable: true,  yields: 1 },
  wooden_shovel:    { requires: { oak_planks: 1, stick: 2 },                                  needsTable: true,  yields: 1 },
  wooden_hoe:       { requires: { oak_planks: 2, stick: 2 },                                  needsTable: true,  yields: 1 },

  // ─── Stone chain ────────────────────────────────────────────────────
  stone_pickaxe:    { requires: { cobblestone: 3, stick: 2 },                                 needsTable: true,  yields: 1 },
  stone_axe:        { requires: { cobblestone: 3, stick: 2 },                                 needsTable: true,  yields: 1 },
  stone_sword:      { requires: { cobblestone: 2, stick: 1 },                                 needsTable: true,  yields: 1 },
  stone_shovel:     { requires: { cobblestone: 1, stick: 2 },                                 needsTable: true,  yields: 1 },
  stone_hoe:        { requires: { cobblestone: 2, stick: 2 },                                 needsTable: true,  yields: 1 },
  furnace:          { requires: { cobblestone: 8 },                                            needsTable: true,  yields: 1 },
  stone_button:     { requires: { stone: 1 },                                                  needsTable: false, yields: 1 },

  // ─── Iron chain ─────────────────────────────────────────────────────
  iron_pickaxe:     { requires: { iron_ingot: 3, stick: 2 },                                  needsTable: true,  yields: 1 },
  iron_axe:         { requires: { iron_ingot: 3, stick: 2 },                                  needsTable: true,  yields: 1 },
  iron_sword:       { requires: { iron_ingot: 2, stick: 1 },                                  needsTable: true,  yields: 1 },
  iron_shovel:      { requires: { iron_ingot: 1, stick: 2 },                                  needsTable: true,  yields: 1 },
  iron_hoe:         { requires: { iron_ingot: 2, stick: 2 },                                  needsTable: true,  yields: 1 },
  iron_helmet:      { requires: { iron_ingot: 5 },                                             needsTable: true,  yields: 1 },
  iron_chestplate:  { requires: { iron_ingot: 8 },                                             needsTable: true,  yields: 1 },
  iron_leggings:    { requires: { iron_ingot: 7 },                                             needsTable: true,  yields: 1 },
  iron_boots:       { requires: { iron_ingot: 4 },                                             needsTable: true,  yields: 1 },
  bucket:           { requires: { iron_ingot: 3 },                                             needsTable: true,  yields: 1 },
  shield:           { requires: { iron_ingot: 1, oak_planks: 6 },                              needsTable: true,  yields: 1 },
  flint_and_steel:  { requires: { iron_ingot: 1, flint: 1 },                                   needsTable: false, yields: 1 },

  // ─── Gold chain ─────────────────────────────────────────────────────
  golden_apple:     { requires: { apple: 1, gold_ingot: 8 },                                   needsTable: true,  yields: 1 },
  golden_pickaxe:   { requires: { gold_ingot: 3, stick: 2 },                                   needsTable: true,  yields: 1 },

  // ─── Diamond chain ──────────────────────────────────────────────────
  diamond_pickaxe:  { requires: { diamond: 3, stick: 2 },                                      needsTable: true,  yields: 1 },
  diamond_axe:      { requires: { diamond: 3, stick: 2 },                                      needsTable: true,  yields: 1 },
  diamond_sword:    { requires: { diamond: 2, stick: 1 },                                      needsTable: true,  yields: 1 },
  diamond_helmet:   { requires: { diamond: 5 },                                                 needsTable: true,  yields: 1 },
  diamond_chestplate:{ requires: { diamond: 8 },                                                needsTable: true,  yields: 1 },
  diamond_leggings: { requires: { diamond: 7 },                                                 needsTable: true,  yields: 1 },
  diamond_boots:    { requires: { diamond: 4 },                                                 needsTable: true,  yields: 1 },

  // ─── Storage / utilities ────────────────────────────────────────────
  chest:            { requires: { oak_planks: 8 },                                              needsTable: true,  yields: 1 },
  torch:            { requires: { coal: 1, stick: 1 },                                          needsTable: false, yields: 4 },
  ladder:           { requires: { stick: 7 },                                                    needsTable: true,  yields: 3 },
  door:             { requires: { oak_planks: 6 },                                               needsTable: true,  yields: 3 },
  bed:              { requires: { oak_planks: 3, white_wool: 3 },                                needsTable: true,  yields: 1 },
  bow:              { requires: { stick: 3, string: 3 },                                         needsTable: true,  yields: 1 },
  arrow:            { requires: { stick: 1, flint: 1, feather: 1 },                              needsTable: false, yields: 4 },
  fishing_rod:      { requires: { stick: 3, string: 2 },                                         needsTable: true,  yields: 1 },
  compass:          { requires: { iron_ingot: 4, redstone: 1 },                                  needsTable: true,  yields: 1 },
  clock:            { requires: { gold_ingot: 4, redstone: 1 },                                  needsTable: true,  yields: 1 },

  // ─── Nether / end prep ──────────────────────────────────────────────
  eye_of_ender:     { requires: { ender_pearl: 1, blaze_powder: 1 },                            needsTable: false, yields: 1 },
  blaze_powder:     { requires: { blaze_rod: 1 },                                               needsTable: false, yields: 2 },
  ender_chest:      { requires: { obsidian: 8, ender_pearl: 1 },                                needsTable: true,  yields: 1 },
  crafting_table_nether: { requires: { crimson_planks: 4 },                                     needsTable: false, yields: 1 },

  // ─── Food ───────────────────────────────────────────────────────────
  bread:            { requires: { wheat: 3 },                                                    needsTable: false, yields: 1 },
  cookie:           { requires: { wheat: 2, cocoa_beans: 1 },                                    needsTable: false, yields: 8 },
  cake:             { requires: { milk_bucket: 3, egg: 1, sugar: 2, wheat: 3 },                  needsTable: true,  yields: 1 },

  // ─── Enchanting ─────────────────────────────────────────────────────
  enchanting_table: { requires: { book: 1, diamond: 2, obsidian: 4 },                           needsTable: true,  yields: 1 },
  bookshelf:        { requires: { book: 3, oak_planks: 6 },                                      needsTable: true,  yields: 1 },
  book:             { requires: { paper: 3, leather: 1 },                                        needsTable: false, yields: 1 },
  paper:            { requires: { sugar_cane: 3 },                                               needsTable: false, yields: 3 },
};

const SMELT_RECIPES = {
  raw_iron:          { output: "iron_ingot",    fuelCost: 1 },
  raw_gold:          { output: "gold_ingot",    fuelCost: 1 },
  raw_copper:        { output: "copper_ingot",  fuelCost: 1 },
  iron_ore:          { output: "iron_ingot",    fuelCost: 1 },
  gold_ore:          { output: "gold_ingot",    fuelCost: 1 },
  sand:              { output: "glass",         fuelCost: 1 },
  cobblestone:       { output: "stone",         fuelCost: 1 },
  beef:              { output: "cooked_beef",   fuelCost: 1 },
  porkchop:          { output: "cooked_porkchop", fuelCost: 1 },
  chicken:           { output: "cooked_chicken", fuelCost: 1 },
  mutton:            { output: "cooked_mutton", fuelCost: 1 },
  potato:            { output: "baked_potato",  fuelCost: 1 },
  cod:               { output: "cooked_cod",    fuelCost: 1 },
  salmon:            { output: "cooked_salmon", fuelCost: 1 },
  wood:              { output: "charcoal",      fuelCost: 1.5 }, // any log
  clay_ball:         { output: "brick",         fuelCost: 1 },
};

const FUEL_VALUES = {
  coal: 8, charcoal: 8, coal_block: 80,
  oak_log: 1.5, oak_planks: 1.5, stick: 0.5,
  blaze_rod: 12, lava_bucket: 100,
};

/**
 * Resolves what raw materials are needed to craft `targetItem` × `count`.
 * Returns { items: {name: total_needed}, canSmelt: bool, missing: {name: qty} }
 */
function resolve(targetItem, count, inventory) {
  const needed = {};
  _collect(targetItem, count, needed, inventory, 0);
  const missing = {};
  for (const [name, qty] of Object.entries(needed)) {
    const have = _countInv(inventory, name);
    if (have < qty) missing[name] = qty - have;
  }
  return { needed, missing };
}

function _collect(item, count, needed, inventory, depth) {
  if (depth > 20) return;
  const recipe = CRAFTING_RECIPES[item];
  if (!recipe) {
    needed[item] = (needed[item] || 0) + count;
    return;
  }
  const batches = Math.ceil(count / recipe.yields);
  for (const [req, reqCount] of Object.entries(recipe.requires)) {
    const have = _countInv(inventory, req);
    const stillNeed = Math.max(0, reqCount * batches - have);
    if (stillNeed > 0) _collect(req, stillNeed, needed, inventory, depth + 1);
  }
}

function _countInv(inventory, name) {
  return inventory.items().filter((i) => i.name === name).reduce((s, i) => s + i.count, 0);
}

/**
 * Returns the shortest crafting path (list of items to craft in order)
 * from current inventory to `targetItem`.
 */
function craftingPath(targetItem, inventory) {
  const path = [];
  _buildPath(targetItem, inventory, path, new Set(), 0);
  return path;
}

function _buildPath(item, inventory, path, visited, depth) {
  if (depth > 20 || visited.has(item)) return;
  visited.add(item);
  const recipe = CRAFTING_RECIPES[item];
  if (!recipe) return;
  for (const req of Object.keys(recipe.requires)) {
    if (!_countInv(inventory, req) && !visited.has(req)) {
      _buildPath(req, inventory, path, visited, depth + 1);
    }
  }
  if (!path.includes(item)) path.push(item);
}

module.exports = { CRAFTING_RECIPES, SMELT_RECIPES, FUEL_VALUES, resolve, craftingPath };
