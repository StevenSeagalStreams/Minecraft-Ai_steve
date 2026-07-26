# Project: Emberfall (working title) — Idle Narrative RPG

A production-ready idle/incremental mobile game combining infinite progression
(prestige resets, exponential scaling) with a dynamic, data-driven narrative system.

## Repository layout

This repository also contains an unrelated Minecraft AI bot at the root. The
game lives in **`emberfall/`** — every `src/...` path below is relative to it
(`src/engine/` means `emberfall/src/engine/`), and all commands run from
`emberfall/`.

## Tech Stack (LOCKED — do not propose alternatives)

- **Framework:** React Native + Expo SDK (managed workflow), TypeScript strict mode
- **State:** Zustand with `persist` middleware
- **Storage:** `react-native-mmkv` (atomic writes, custom Zustand storage adapter)
- **Big numbers:** `break_infinity.js` — ALL resource/cost/rate values are `Decimal`,
  never raw `number`, except UI-only values like animation timers
- **Testing:** Jest + ts-jest for pure logic; no E2E for now

## Architecture Rules

1. **Engine/UI separation is absolute.** The game engine is pure TypeScript with
   zero React imports. It lives in `src/engine/` and exposes a `tick(deltaMs)`
   function. React components only read store state and dispatch actions.
   A React hook (`useGameLoop`) drives the engine but contains no game logic.
2. **Data-driven everything.** Balance values, upgrade definitions, story nodes,
   prestige formulas' constants — all live in `src/data/*.ts` as typed config
   objects. Game logic files never contain magic numbers.
3. **Feature-based folders:**
   - `src/engine/` — tick loop, offline progress calc, time drift handling
   - `src/features/idle/` — resources, generators, automation
   - `src/features/upgrades/` — upgrade trees, cost curves
   - `src/features/prestige/` — ascension/rebirth logic, persistent meta-currency
   - `src/features/story/` — narrative nodes, triggers, choice effects
   - `src/math/` — Decimal helpers, formatting (1.23e45 → "1.23 QaDc"), scaling formulas
   - `src/data/` — all config/balance data
   - `src/store/` — Zustand store, persistence, save-file versioning
   - `src/components/`, `src/screens/` — UI only
4. **Save file discipline.** The save schema has a `version: number` field and a
   migration registry. Any change to persisted state shape REQUIRES a new version
   and a migration function. Decimal values are serialized as strings.
5. **Determinism.** Offline progress and tick math must be deterministic and
   testable: pure functions of (state, elapsedMs, config). No `Date.now()` inside
   engine functions — time is always passed in.

## Serialization Rules (critical — common bug source)

- `Decimal` does not survive JSON round-trips. The store's persist layer must
  serialize `Decimal` → string and revive string → `Decimal` on load.
- Never spread persisted state directly into the store without reviving Decimals.

## Coding Conventions

- TypeScript `strict: true`, no `any`, no `@ts-ignore` without a comment explaining why
- Interfaces for: `SaveFile`, `GameConfig`, `ResourceDef`, `UpgradeDef`,
  `StoryNode`, `StoryChoice`, `PrestigeState`
- Prefer small pure functions; engine functions take state in, return new state out
- Keep files under ~300 lines; split when larger

## Workflow Rules

- After ANY code change: run `npx tsc --noEmit` and `npm test`. Fix failures
  before reporting done.
- Write Jest tests alongside all `src/math/` and `src/engine/` code — these are
  the highest-risk areas (precision, offline calc, prestige formulas).
- Commit at the end of each completed milestone with a descriptive message.
- If a requirement is ambiguous, choose the simplest interpretation that keeps
  the data-driven and engine/UI-separation rules intact, note the assumption,
  and continue. Do not stop to ask unless the choice is architecturally irreversible.

## Verify Commands

Run from `emberfall/`:

- Typecheck: `npx tsc --noEmit`
- Tests: `npm test`
- Run app: `npx expo start`

## Architecture invariants are enforced by tests

`src/engine/__tests__/architecture.test.ts` fails the build if the pure layers
(`engine`, `features`, `math`, `data`, `types`) import React, react-native or
zustand; if any of them contains a `.tsx` file; if an engine or feature file
calls `Date.now()`; or if any source file exceeds 300 lines. Treat a failure
there as a design error, not a test to relax.
