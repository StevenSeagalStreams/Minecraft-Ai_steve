"use strict";

/**
 * GOAP Action library.
 *
 * Each action has:
 *   name        - unique identifier
 *   cost        - base cost (lower = preferred)
 *   preconditions - WorldState requirements
 *   effects       - WorldState changes after execution
 *   execute(ctx)  - async function that runs the action
 *
 * The GOAP planner uses preconditions/effects to chain actions into plans.
 * execute() receives the full { bot, systems } context object.
 */

const ACTIONS = [
  // ─── Survival / Eating ────────────────────────────────────────────────────
  {
    name: "EatFood",
    cost: 1,
    preconditions: { hasFood: true },
    effects:       { isHungry: false, isStarving: false, isLowHealth: false },
    async execute({ survival }) { await survival.eat(); },
  },
  {
    name: "GatherFood",
    cost: 5,
    preconditions: { hasWoodenSword: true },
    effects:       { hasFood: true },
    async execute({ resources }) { await resources.huntPassiveMob(); },
  },
  {
    name: "CookFood",
    cost: 3,
    preconditions: { hasFurnace: true, hasCoal: true },
    effects:       { hasFood: true, hasFoodReserve: true },
    async execute({ crafting, inventory }) {
      const raw = await ({ resources: null }).cookRawFood?.() ?? null;
      if (raw) await crafting.smelt(raw.item, raw.count);
    },
  },

  // ─── Crafting table & furnace ─────────────────────────────────────────────
  {
    name: "CraftCraftingTable",
    cost: 2,
    preconditions: { hasWood: true },
    effects:       { hasCraftingTable: true },
    async execute({ crafting }) { await crafting.craft("crafting_table", 1); },
  },
  {
    name: "CraftFurnace",
    cost: 3,
    preconditions: { hasStone: true, hasCraftingTable: true },
    effects:       { hasFurnace: true },
    async execute({ crafting }) { await crafting.craft("furnace", 1); },
  },

  // ─── Wood tools ───────────────────────────────────────────────────────────
  {
    name: "GatherWood",
    cost: 3,
    preconditions: {},
    effects:       { hasWood: true },
    async execute({ resources }) { await resources.gatherWood(8); },
  },
  {
    name: "CraftWoodenTools",
    cost: 2,
    preconditions: { hasWood: true, hasCraftingTable: true },
    effects:       { hasWoodenPickaxe: true, hasWoodenSword: true },
    async execute({ crafting }) { await crafting.craftWoodenTools(); },
  },

  // ─── Stone tools ──────────────────────────────────────────────────────────
  {
    name: "GatherStone",
    cost: 3,
    preconditions: { hasWoodenPickaxe: true },
    effects:       { hasStone: true },
    async execute({ resources }) { await resources.gatherStone(16); },
  },
  {
    name: "CraftStoneTools",
    cost: 2,
    preconditions: { hasStone: true, hasCraftingTable: true, hasWoodenPickaxe: true },
    effects:       { hasStonePickaxe: true, hasStoneSword: true },
    async execute({ crafting }) { await crafting.craftStoneTools(); },
  },
  {
    name: "MineCoal",
    cost: 3,
    preconditions: { hasStonePickaxe: true },
    effects:       { hasCoal: true },
    async execute({ resources }) { await resources.gatherOre("coal", 8); },
  },
  {
    name: "MakeTorches",
    cost: 2,
    preconditions: { hasCoal: true, hasWood: true },
    effects:       { hasTorch: true },
    async execute({ crafting }) {
      await crafting.craft("stick", 4);
      await crafting.craft("torch", 8);
    },
  },

  // ─── Iron tools & armor ───────────────────────────────────────────────────
  {
    name: "MineIron",
    cost: 4,
    preconditions: { hasStonePickaxe: true },
    effects:       { hasRawIron: true },
    async execute({ resources }) { await resources.gatherOre("iron", 6); },
  },
  {
    name: "SmeltIron",
    cost: 3,
    preconditions: { hasRawIron: true, hasFurnace: true, hasCoal: true },
    effects:       { hasIronIngot: true },
    async execute({ crafting, inventory }) {
      const count = inventory.countOf("raw_iron");
      await crafting.smelt("raw_iron", count);
    },
  },
  {
    name: "CraftIronTools",
    cost: 2,
    preconditions: { hasIronIngot: true, hasCraftingTable: true },
    effects:       { hasIronPickaxe: true, hasIronSword: true },
    async execute({ crafting }) { await crafting.craftIronTools(); },
  },
  {
    name: "CraftIronArmor",
    cost: 4,
    preconditions: { hasIronIngot: true, hasCraftingTable: true },
    effects:       { hasIronArmor: true },
    async execute({ crafting }) { await crafting.craftFullIronArmor(); },
  },
  {
    name: "CraftShield",
    cost: 2,
    preconditions: { hasIronIngot: true, hasWood: true, hasCraftingTable: true },
    effects:       { hasShield: true },
    async execute({ crafting }) { await crafting.craft("shield", 1); },
  },

  // ─── Diamond ──────────────────────────────────────────────────────────────
  {
    name: "MineDiamond",
    cost: 8,
    preconditions: { hasIronPickaxe: true },
    effects:       { hasDiamond: true },
    async execute({ resources }) { await resources.gatherOre("diamond", 4); },
  },
  {
    name: "CraftDiamondTools",
    cost: 3,
    preconditions: { hasDiamond: true, hasCraftingTable: true },
    effects:       { hasDiamondPickaxe: true },
    async execute({ crafting }) {
      await crafting.craft("diamond_pickaxe", 1);
      await crafting.craft("diamond_sword", 1);
    },
  },

  // ─── Base building ────────────────────────────────────────────────────────
  {
    name: "BuildShelter",
    cost: 6,
    preconditions: { hasWood: true },
    effects:       { hasBase: true, inBase: true },
    async execute({ base }) { await base.buildEmergencyShelter(); },
  },
  {
    name: "UpgradeBase",
    cost: 8,
    preconditions: { hasBase: true, hasStone: true },
    effects:       { basePhase: 2 },
    async execute({ base }) { await base.upgradeToStarterBase(); },
  },
  {
    name: "PlaceChest",
    cost: 3,
    preconditions: { hasBase: true },
    effects:       { hasChest: true, inventoryFull: false },
    async execute({ storage }) { await storage.placeChest(); },
  },
  {
    name: "DepositItems",
    cost: 2,
    preconditions: { hasChest: true },
    effects:       { inventoryFull: false },
    async execute({ storage }) { await storage.depositExcess(); },
  },

  // ─── Sleeping ─────────────────────────────────────────────────────────────
  {
    name: "CraftBed",
    cost: 4,
    preconditions: { hasWood: true, hasCraftingTable: true },
    effects:       { hasBed: true },
    async execute({ crafting }) { await crafting.craft("bed", 1).catch(() => null); },
  },
  {
    name: "Sleep",
    cost: 1,
    preconditions: { hasBed: true, inBase: true, isNight: true },
    effects:       { isNight: false },
    async execute({ survival }) { await survival.sleep(); },
  },

  // ─── Farming ──────────────────────────────────────────────────────────────
  {
    name: "BuildFarm",
    cost: 10,
    preconditions: { hasBase: true, hasIronPickaxe: true },
    effects:       { hasFarm: true, hasFoodReserve: true },
    async execute({ farming }) { await farming.buildFarm("wheat"); },
  },
  {
    name: "HarvestFarm",
    cost: 3,
    preconditions: { hasFarm: true },
    effects:       { hasFood: true, hasFoodReserve: true },
    async execute({ farming }) { await farming.harvestFarm(); },
  },

  // ─── Exploration ──────────────────────────────────────────────────────────
  {
    name: "Explore",
    cost: 15,
    preconditions: {},
    effects:       { hasWood: true, hasStone: true }, // probabilistic benefit
    async execute({ navigation, memory, bot }) {
      const base = memory.base ?? bot.entity.position;
      await navigation.exploreRandomly(base, 80);
    },
  },
];

module.exports = ACTIONS;
