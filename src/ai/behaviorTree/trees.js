"use strict";

const {
  SUCCESS, FAILURE, Sequence, Selector, Condition, Action, AlwaysSucceed, Retry, Inverter,
} = require("./nodes");

/**
 * Assembled Behaviour Trees used by SurvivalManager.
 * Each tree is a pure function that takes ctx and returns a BTNode root.
 * ctx = { bot, survival, combat, navigation, crafting, resources, base, storage, farming,
 *          inventory, memory, perception, config, logger }
 */

// ─── Survival Tree (highest priority) ────────────────────────────────────────

function buildSurvivalTree() {
  return new Selector("Survival", [
    // 1. Warden present → always run
    new Sequence("FleeWarden", [
      new Condition("WardenNearby", ({ perception }) =>
        perception.last?.hostileMobs?.some((m) => m.name === "warden") ?? false
      ),
      new Action("FleeWarden", async ({ navigation, survival }) => {
        const snap = survival.perception?.last;
        const warden = snap?.hostileMobs?.find((m) => m.name === "warden");
        if (warden) await navigation.fleeFrom(warden.position, 40);
        return true;
      }),
    ]),

    // 2. Critical health → flee + eat
    new Sequence("CriticalHealth", [
      new Condition("IsCritical", ({ bot, config }) => bot.health <= config.health.critical),
      new Action("Retreat", async ({ navigation, combat, memory }) => {
        const snap = combat.perception?.last;
        if (snap?.hostileMobs?.length) await navigation.fleeFrom(snap.hostileMobs[0].position, 24);
        if (memory.hasBase()) await navigation.goTo(memory.base, { range: 3, timeoutMs: 20000 }).catch(() => null);
        return true;
      }),
      new Action("EatEmergency", async ({ survival }) => { await survival.eat(); return true; }),
    ]),

    // 3. Starving → eat or gather food
    new Sequence("HandleStarving", [
      new Condition("IsStarving", ({ bot, config }) => bot.food <= config.hunger.critical),
      new Selector("GetFood", [
        new Action("EatFromInventory", async ({ survival }) => survival.eat()),
        new Action("HarvestFarm",      async ({ farming }) => !!(await farming.harvestFarm())),
        new Action("HuntFood",         async ({ resources }) => resources.huntPassiveMob()),
      ]),
    ]),

    // 4. Low health + hostile nearby → engage or retreat based on equipment
    new Sequence("CombatResponse", [
      new Condition("HostileNearby", ({ perception }) =>
        (perception.last?.hostileMobs?.length ?? 0) > 0
      ),
      new Action("HandleCombat", async ({ combat, perception }) => {
        const mobs = perception.last?.hostileMobs ?? [];
        await combat.handleThreats(mobs);
        return true;
      }),
    ]),

    // 5. Hazard avoidance
    new Sequence("AvoidHazards", [
      new Condition("HazardNear", ({ perception }) => perception.isHazardNearby(3)),
      new Action("MoveFromHazard", async ({ navigation, memory }) => {
        if (memory.hasBase()) {
          await navigation.goTo(memory.base, { range: 5, timeoutMs: 10000 }).catch(() => null);
        }
        return true;
      }),
    ]),

    // 6. Hungry (not critical) → eat while continuing
    new Sequence("HandleHunger", [
      new Condition("IsHungry", ({ bot, config }) => bot.food < config.hunger.low),
      new Action("Eat", async ({ survival }) => { await survival.eat(); return true; }),
    ]),

    // 7. Night time + no shelter → rush home
    new Sequence("NightShelter", [
      new Condition("NightOutside", ({ perception, base }) =>
        (perception.last?.isNight ?? false) && !base.isNearBase()
      ),
      new Action("GoHome", async ({ navigation, memory }) => {
        if (memory.hasBase()) {
          await navigation.goTo(memory.base, { range: 3, timeoutMs: 30000 }).catch(() => null);
        }
        return true;
      }),
    ]),

    // 8. Sleep
    new Sequence("TrySleep", [
      new Condition("CanSleep", ({ perception, base }) =>
        (perception.last?.isNight ?? false) && base.isNearBase()
      ),
      new Action("Sleep", async ({ survival }) => { await survival.sleep(); return true; }),
    ]),

    // 9. Otherwise: nothing threatening
    new Action("AllClear", async () => SUCCESS),
  ]);
}

// ─── Tactical Tree (normal goal execution) ────────────────────────────────────

function buildTacticalTree() {
  return new Selector("Tactical", [
    // Inventory full → deposit or drop junk
    new Sequence("HandleFullInventory", [
      new Condition("InventoryFull", ({ inventory }) => inventory.isFull()),
      new Selector("ClearInventory", [
        new Action("DepositItems",   async ({ storage })   => storage.depositExcess()),
        new Action("DropJunk",       async ({ inventory }) => { await inventory.dropJunk(); return true; }),
      ]),
    ]),

    // No wooden tools → gather wood + craft
    new Sequence("GetWoodenTools", [
      new Condition("NoWoodenTools", ({ inventory }) =>
        !inventory.has("wooden_pickaxe") && !inventory.has("stone_pickaxe") && !inventory.has("iron_pickaxe")
      ),
      new Retry("GatherWoodRetry", new Action("GatherWood", async ({ resources }) => {
        await resources.gatherWood(8); return true;
      }), 3),
      new Action("CraftWooden", async ({ crafting }) => { await crafting.craftWoodenTools(); return true; }),
    ]),

    // No shelter → build one before dark
    new Sequence("BuildShelterStep", [
      new Condition("NoBase", ({ memory }) => !memory.hasBase()),
      new Action("GatherForShelter", async ({ resources }) => { await resources.gatherWood(12); return true; }),
      new Action("BuildShelter", async ({ base }) => base.buildEmergencyShelter()),
    ]),

    // No stone tools → gather stone + craft
    new Sequence("GetStoneTools", [
      new Condition("NoStoneTools", ({ inventory }) =>
        !inventory.has("stone_pickaxe") && !inventory.has("iron_pickaxe") && inventory.has("wooden_pickaxe")
      ),
      new Action("GatherStone", async ({ resources }) => { await resources.gatherStone(16); return true; }),
      new Action("CraftStone",  async ({ crafting }) => { await crafting.craftStoneTools(); return true; }),
    ]),

    // Mine coal + make torches
    new Sequence("GetTorches", [
      new Condition("NeedTorches", ({ inventory }) => inventory.countOf("torch") < 8),
      new Action("MineCoal",   async ({ resources }) => { await resources.gatherOre("coal", 8); return true; }),
      new Action("MakeTorches",async ({ crafting }) => { await crafting.craft("torch", 8); return true; }),
    ]),

    // Iron age
    new Sequence("GetIronTools", [
      new Condition("NoIronTools", ({ inventory }) =>
        !inventory.has("iron_pickaxe") && inventory.has("stone_pickaxe")
      ),
      new Action("MineIron",  async ({ resources }) => { await resources.gatherOre("iron", 6); return true; }),
      new Action("SmeltIron", async ({ crafting, inventory }) => {
        await crafting.smelt("raw_iron", inventory.countOf("raw_iron")); return true;
      }),
      new Action("CraftIron", async ({ crafting }) => { await crafting.craftIronTools(); return true; }),
    ]),

    // Iron armor
    new Sequence("GetIronArmor", [
      new Condition("NoArmor", ({ inventory }) => !inventory.has("iron_chestplate")),
      new Condition("HasIron",  ({ inventory }) => inventory.countOf("iron_ingot") >= 20),
      new Action("CraftArmor", async ({ crafting }) => { await crafting.craftFullIronArmor(); return true; }),
      new Action("EquipArmor", async ({ inventory }) => { await inventory.equipArmor(); return true; }),
    ]),

    // Upgrade base
    new Sequence("UpgradeBaseStep", [
      new Condition("Phase1", ({ memory }) => (memory.base?.phase ?? 0) === 1),
      new Condition("HasStone", ({ inventory }) => inventory.countOf("cobblestone") >= 32),
      new Action("UpgradeBase", async ({ base }) => base.upgradeToStarterBase()),
    ]),

    // Farm food
    new Sequence("BuildFarmStep", [
      new Condition("NeedFarm", ({ memory }) => (memory.data?.farms?.length ?? 0) === 0),
      new Condition("HasIron",  ({ inventory }) => inventory.has("iron_pickaxe")),
      new Action("BuildFarm", async ({ farming }) => farming.buildFarm("wheat")),
    ]),

    // Diamond phase
    new Sequence("GetDiamonds", [
      new Condition("ReadyForDiamonds", ({ inventory }) =>
        inventory.has("iron_pickaxe") && inventory.has("iron_chestplate")
      ),
      new Condition("NoDiamond", ({ inventory }) => inventory.countOf("diamond") < 3),
      new Action("MineDiamond", async ({ resources }) => { await resources.gatherOre("diamond", 4); return true; }),
    ]),

    // Fall-through: explore
    new Action("Explore", async ({ navigation, memory, bot }) => {
      const origin = memory.base ?? bot.entity.position;
      await navigation.exploreRandomly(origin, 64);
      return true;
    }),
  ]);
}

module.exports = { buildSurvivalTree, buildTacticalTree };
