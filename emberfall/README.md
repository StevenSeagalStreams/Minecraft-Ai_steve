# Emberfall

An idle/incremental mobile game: infinite progression (prestige resets,
exponential scaling) wrapped around a data-driven narrative that reacts to how
the run is going.

The world went out. You are holding the last of it.

## Stack

React Native + Expo (managed) · TypeScript strict · Zustand + `persist` ·
`react-native-mmkv` · `break_infinity.js` · Jest + ts-jest

## Running it

```bash
npm install
npx expo start     # run the app
npx tsc --noEmit   # typecheck
npm test           # 175 Jest tests
```

## Architecture

```
src/
  engine/     tick loop, offline catch-up, time-drift handling   (pure TS)
  features/
    idle/       resources, generators, automation
    upgrades/   upgrade tree, cost curves, derived modifiers
    prestige/   ascension, persistent meta-currency
    story/      narrative triggers, choices, branching
  math/       Decimal helpers, number formatting, scaling formulas
  data/       every balance value, definition, and story node
  store/      Zustand store, MMKV persistence, save versioning
  components/ presentational UI
  screens/    tab screens and the root screen
  hooks/      useGameLoop — drives the engine, holds no game logic
  types/      shared interfaces
```

### The rules this codebase actually enforces

**Engine/UI separation is absolute.** `src/engine/`, `src/features/`,
`src/math/`, `src/data/` and `src/types/` import no React, no React Native, no
Zustand. `useGameLoop` decides *when* the engine runs and supplies the clock;
it contains no game logic. This is checked by
`src/engine/__tests__/architecture.test.ts`, not left to discipline.

**Determinism.** Engine functions are pure functions of
`(state, elapsedMs, config)`. No engine or feature file calls `Date.now()` —
time is always a parameter, which is why offline progress is testable at all.
The same test file enforces that too.

**Data-driven.** Balance values, unlock gates, upgrade effects and story
triggers are typed config objects in `src/data/`. Logic files contain no magic
numbers: gates are `ConditionDef` values and bonuses are `EffectDef` values,
both interpreted by a single evaluator.

**Every big number is a `Decimal`.** Resources, costs, rates and generator
counts are `break_infinity.js` values. Raw `number` is reserved for UI-only
quantities (durations, upgrade levels, progress fractions).

## Save files

The save is `{ version, savedAt, state }`, with every `Decimal` written as a
string.

`Decimal` does not survive a JSON round-trip. It *stringifies* fine — the class
defines `toJSON` — which is the trap: the value comes back as a plain string
with no methods, and the first `.mul()` on it throws. `deserializeGameState` is
the single place strings become `Decimal` again, and nothing else may spread
persisted data into live state.

Changing the *shape* of persisted state requires bumping
`CURRENT_SAVE_VERSION` and adding a migration keyed by the version it upgrades
from; migrations are walked one step at a time. Adding new content does **not**
need a migration — saves are layered onto a state built from the current
config, so new definitions arrive at their defaults and removed ones are
dropped.

Loading never throws. A missing, malformed, or future-versioned save falls back
to a new run and reports which happened, rather than failing silently.

## Progression

Seven generator tiers across two resources (Embers, then Lumen), an upgrade
tree spanning production, automation, prestige and story-gated unlocks, and
ascension: run totals convert to Ember Shards via
`gain = (runTotal / divisor) ^ exponent`, and shards grant a permanent
production bonus.

Ascension keeps persistent resources, persistent (shard-bought) upgrades,
lifetime totals, story flags and choice history. It clears the run: balances,
generators, non-persistent upgrades and per-run totals.

Unlock gates deliberately use **run-scoped** totals. Lifetime-scoped gates
survive ascension, which would leave every later run instantly unlocked —
`lifetimeResourceAtLeast` still exists for the cases that genuinely want that
(story beats you should not re-read).

### Offline progress

Time away is simulated in fixed steps rather than integrated in one jump, so
autobuyers compound while away exactly as they would online, scaled by the
offline efficiency. It is capped, and the UI reports what the cap discarded
instead of quietly rounding it away.

A backward-moving clock awards nothing and simply resynchronises, so winding
the device clock back and forth cannot be farmed.

## Tests

175 Jest tests, concentrated on the risky parts: Decimal precision and
serialization, number formatting, cost-curve inversion (`bulkCost` and
`maxAffordable` are checked as exact inverses), tick determinism, offline
catch-up, prestige, save migration, and the architecture rules above.

Engine tests run against a small fixture config in `src/testing/`, not the
shipping balance data — retuning the game cannot turn a determinism regression
into a green test run.
