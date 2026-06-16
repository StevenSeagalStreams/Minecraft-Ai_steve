# Minecraft AI Steve

An autonomous, modular Mineflayer bot that survives and progresses on its
own in a Minecraft survival world: gathering wood/stone/iron, crafting
tools, building a shelter, storing loot in chests, eating, and fighting
or fleeing from hostile mobs.

## File Structure

```
.
├── config.js                  # Connection + tuning settings
├── package.json
└── src/
    ├── main.js                # Central controller / state machine
    ├── perception.js          # World scanning (blocks, mobs, items)
    ├── navigation.js           # Pathfinding wrapper (mineflayer-pathfinder)
    ├── resourceManager.js      # Wood/stone/ore gathering
    ├── inventoryManager.js     # Inventory tracking & tool selection
    ├── craftingSystem.js       # Dynamic crafting + smelting
    ├── storageSystem.js        # Chest placement/deposit/withdraw
    ├── combatSystem.js         # Target selection, attack, flee
    ├── survivalSystem.js       # Eating, health, hazard/night handling
    ├── buildingSystem.js       # Shelter construction & expansion
    ├── goalPlanner.js          # Wood -> stone -> iron progression
    └── memorySystem.js         # Base/resource/danger-zone memory
```

## Installation

```bash
npm install
```

Requires Node.js >= 18.

## Configuration

Set environment variables (or edit `config.js` directly) before running:

| Variable        | Default     | Description                          |
|-----------------|-------------|---------------------------------------|
| `MC_HOST`       | `localhost` | Server address                        |
| `MC_PORT`       | `25565`     | Server port                           |
| `MC_USERNAME`   | `AiSteve`   | Bot username                          |
| `MC_PASSWORD`   | _(none)_    | Account password (if needed)          |
| `MC_AUTH`       | `offline`   | `offline` or `microsoft`              |
| `MC_VERSION`    | auto        | Force a specific Minecraft version    |

## Running the bot

1. Start a Minecraft Java Edition server (survival mode, offline/cracked
   auth works out of the box with `MC_AUTH=offline`).
2. Run:

```bash
MC_HOST=localhost MC_PORT=25565 MC_USERNAME=AiSteve npm start
```

The bot will connect, spawn, and immediately begin its autonomous loop:
gathering wood, crafting tools, building a shelter before dark, mining
stone and iron, storing surplus items in chests, eating when hungry, and
fighting or fleeing from hostile mobs as needed.

Press `Ctrl+C` to gracefully disconnect.

## Behaviour overview (state machine)

`main.js` runs a tick loop that picks one of: `IDLE`, `EXPLORE`,
`GATHER`, `CRAFT`, `BUILD`, `COMBAT`, `SURVIVE` based on:

1. **SURVIVE/COMBAT** — always takes priority when hostile mobs are
   nearby or health is critical.
2. **BUILD** (storage) — triggers when the inventory is nearly full.
3. Otherwise the `goalPlanner` determines the next progression task
   (wood tools → shelter → stone tools → storage → iron tools →
   maintain), which maps to `GATHER`, `CRAFT`, or `BUILD`.
4. **EXPLORE** — used when no relevant resources are found nearby.

## Notes & edge cases handled

- **No resources nearby**: falls back to remembered resource
  locations in `memorySystem`, then to `EXPLORE`.
- **Inventory full**: deposits non-essential items into the nearest
  chest, or drops low-priority junk if no chest is reachable.
- **Low/critical health**: flees from threats and retreats toward the
  known base location.
- **Stuck navigation**: pathfinding calls are wrapped with timeouts
  that reject and let the state machine try something else next tick.
- **Hazards** (lava, cliffs): `survivalSystem.avoidHazards` and
  `perception.hasCliffAhead` stop movement before stepping into danger.
