# AI Steve v2 — Autonomous Minecraft Survival Agent

A production-grade, fully autonomous Minecraft survival bot built on
[Mineflayer](https://github.com/PrismarineJS/mineflayer).

The agent uses a **three-layer AI architecture** to survive indefinitely,
progress through the full technology tree, and adapt to dynamic conditions
without human input.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  MAIN LOOP  (main.js)  — FSM: BOOTING|SURVIVAL|TACTICAL|PLANNING │
├──────────────────────────────────────────────────────────────────┤
│  Layer 1 ─ SurvivalManager (highest priority)                    │
│            Health · Hunger · Hazards · Fire · Drowning · Night   │
├──────────────────────────────────────────────────────────────────┤
│  Layer 2 ─ Behaviour Tree  (tacticalTree)                        │
│            Inventory · Tools · Shelter · Stone · Iron · Diamonds │
├──────────────────────────────────────────────────────────────────┤
│  Layer 3 ─ GOAP Planner + Strategic Planner                      │
│            Long-range goals · Dependency resolution · Replanning │
└──────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
.
├── config.js                         # All tunable parameters
├── package.json
├── data/                             # Auto-created runtime data
│   ├── memory.json                   # Persistent world knowledge
│   ├── aisteve.log                   # Structured log
│   └── telemetry.jsonl               # JSONL telemetry stream
└── src/
    ├── main.js                       # Entry point + FSM orchestrator
    ├── core/
    │   ├── logger.js                 # Colour console + file + telemetry
    │   └── eventBus.js               # Singleton event bus (decoupling)
    ├── memory/
    │   └── memorySystem.js           # Persistent world knowledge store
    ├── perception/
    │   ├── perception.js             # World snapshot (entities, blocks)
    │   └── mobClassifier.js          # Per-mob threat data + engagement policy
    ├── systems/
    │   ├── navigation.js             # Pathfinder wrapper (stuck recovery, flee)
    │   ├── inventoryManager.js       # Item queries, tool selection, priority
    │   ├── craftingGraph.js          # Full recipe + smelt graph + resolver
    │   ├── craftingSystem.js         # Dynamic craft/smelt executor
    │   ├── resourceManager.js        # Wood / stone / ore / food gathering
    │   ├── combatSystem.js           # Threat targeting, per-mob tactics, loot
    │   ├── storageSystem.js          # Chest place / deposit / withdraw
    │   ├── baseManager.js            # 4-phase progressive base builder
    │   ├── farmingSystem.js          # Crop farm builder + harvester
    │   └── deathRecovery.js          # Item retrieval + rebuild after death
    ├── ai/
    │   ├── survivalManager.js        # Eat, sleep, hazard avoidance
    │   ├── riskAssessor.js           # Dynamic [0,1] risk scoring
    │   ├── strategicPlanner.js       # Goal selection + GOAP integration
    │   ├── tacticalController.js     # GOAP action dispatcher
    │   ├── goap/
    │   │   ├── worldState.js         # WorldState class + live capture()
    │   │   ├── actions.js            # 30+ GOAP actions (pre/effect/execute)
    │   │   └── planner.js            # A* GOAP planner
    │   └── behaviorTree/
    │       ├── nodes.js              # BT primitives (Sequence/Selector/…)
    │       └── trees.js              # Assembled survival + tactical trees
    └── progression/
        └── progressionTracker.js     # 13-stage tech-tree tracker
```

---

## Installation

```bash
npm install
```

Requires Node.js ≥ 18.

---

## Configuration

Edit `config.js` or set environment variables:

| Variable       | Default      | Description                       |
|----------------|--------------|-----------------------------------|
| `MC_HOST`      | `localhost`  | Server address                    |
| `MC_PORT`      | `25565`      | Server port                       |
| `MC_USERNAME`  | `AiSteve`    | Bot display name                  |
| `MC_AUTH`      | `offline`    | `offline` or `microsoft`          |
| `MC_VERSION`   | auto         | Pin a specific Minecraft version  |
| `LOG_LEVEL`    | `info`       | `debug` / `info` / `warn` / `error` |

All thresholds (health, hunger, risk, combat range, etc.) are in `config.js`.

---

## Running

```bash
# Offline mode (cracked/local server)
npm start

# With custom settings
MC_HOST=play.example.com MC_PORT=25565 MC_AUTH=microsoft npm start

# Debug mode
LOG_LEVEL=debug node --inspect src/main.js
```

---

## AI Systems

### Survival Manager (Layer 1 — always pre-empts)
- Eats best available food when hungry; emergency eat when starving
- Sleeps in a bed to skip the night / avoid phantoms
- Retreats from fire, lava, and cliffs
- Surfaces to avoid drowning
- Flees to base when night and not sheltered

### Risk Assessor
- Produces a continuous [0,1] danger score from health, hunger, mob
  proximity, environment, and time-of-day
- Tactical work is paused when score ≥ 0.75 (configurable)

### GOAP Planner (A*)
- 30+ defined actions with preconditions and effects
- A* search finds the cheapest path from current state to a goal state
- Full crafting dependency graph auto-resolves prerequisites
- Replans automatically on failure or when the tech-stage changes

### Behaviour Tree (Layer 2)
- **Survival tree**: warden flee → critical health → starving → combat →
  hazards → hunger → night shelter → sleep
- **Tactical tree**: full inventory → wooden tools → shelter → stone tools →
  torches → iron tools → iron armor → base upgrade → farm → diamonds → explore

### Base Manager (4 phases)
| Phase | Trigger                   | Features                              |
|-------|---------------------------|---------------------------------------|
| 1     | Before first night        | 5×5 walled shelter, crafting, furnace |
| 2     | Has stone + phase 1       | 9×9, chests, bed, torches             |
| 3     | Has iron + phase 2        | Expansion room, more storage          |
| 4     | Enchanting ready          | Villager infra, ender chest           |

### Death Recovery
1. Records death position, cause, and lost items
2. Estimates retrieval probability (time, distance, danger)
3. If probable: grabs minimal gear from chest and rushes back
4. If impractical: rebuilds tools from stored reserves

### Mob Combat
Each mob has a data record with threat level and engagement policy:
- `run` (Warden): always flee, never engage
- `avoid` (Piglin Brute): flee unless extremely well-equipped
- `equipped` (Skeleton, Witch): only engage with iron+ gear
- `always` (Zombie, Spider): fight freely

Per-mob tactics: creeper kiting, skeleton melee rush, enderman
no-eye-contact, all with health-based auto-retreat.

### Progression Stages
```
SPAWN → WOOD_TOOLS → STONE_TOOLS → IRON_TOOLS → IRON_ARMOR
     → DIAMOND_TOOLS → ENCHANTING → NETHER_PREP → NETHER
     → BLAZE_FARM → END_PREP → DRAGON → POST_GAME
```

---

## Telemetry

`data/telemetry.jsonl` logs a JSON record every 30 seconds:

```jsonl
{"ts":1700000000,"event":"stats","health":20,"food":18,"stage":"Iron Tools","stats":{"blocksMined":342,"mobsKilled":17,"deaths":1}}
```

Use `jq` or any JSONL viewer to analyse it offline.

---

## Edge Cases Handled

| Situation              | Response                                        |
|------------------------|-------------------------------------------------|
| No resources nearby    | Explores randomly, falls back to memory map     |
| Inventory full         | Deposits to chest, drops junk if no chest       |
| Critical health        | Immediately aborts task, flees, eats            |
| Bot stuck              | Jumps + random jitter after 3 stuck checks      |
| No path found          | Logs FAILURE and retries with next plan step    |
| Death                  | Records site, retrieves if probable, else rebuilds |
| Warden encountered     | Drops everything and sprints; no engagement ever |
| Night with no shelter  | Rushes to base; places/uses bed if available    |
| Starving               | Hunts passive mob; harvests farm; cooks food   |
| No fuel for smelting   | Picks best available fuel from FUEL_VALUES table |
