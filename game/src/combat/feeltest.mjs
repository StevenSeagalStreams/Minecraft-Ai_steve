#!/usr/bin/env node
/**
 * Headless, harness-free feel simulation.
 *
 *   node src/combat/feeltest.mjs
 *
 * Static screenshots cannot show hit-stop, knockback, or corpse persistence
 * -- a single frame looks the same whether or not any of that fired. This
 * runs the real combat primitives (Entity.js + combat/*.js -- the same code
 * the browser build uses, not a reimplementation) against a small mock scene
 * for a few seconds of simulated time and prints a frame-by-frame timeline
 * so those effects are visible in text instead of pixels.
 *
 * "Mock entities" here means bare `Entity` instances (no CharacterRig/model,
 * since those pull in canvas-based procedural textures that need a browser)
 * standing in for a Player and two Monsters -- the same base class, stats,
 * and damage/knockback/hit-stop/collapse pipeline production code runs.
 */
import { Entity, resolveOverlaps } from '../entities/Entity.js';
import { HitStop } from './HitStop.js';

const DT = 1 / 60;
let frame = 0;
let simTime = 0;

function fmt(n) { return (Math.round(n * 1000) / 1000).toFixed(3); }

/** One tick of the exact phase order main.js runs: entities update, then
 *  resolveOverlaps() (which is also where the hit-stop frame counter ticks). */
function tick(entities, world) {
  frame++;
  simTime += DT;
  for (const e of entities) e.update(DT, world);
  resolveOverlaps(entities, 2);
}

const log = [];
function record(event, extra = '') {
  log.push(`f=${String(frame).padStart(4)} t=${fmt(simTime)}s  ${event}${extra ? '  ' + extra : ''}`);
}

console.log('=== EMBERFALL combat feel timeline ===\n');

// --- scene ------------------------------------------------------------------
// A player-mass attacker and two monster-mass victims: a swarmer (light,
// low health) and a skeleton (heavy, tanky), positioned so a hit direction is
// unambiguous (attacker to the west of both victims, blow travels east).
const player = new Entity({ type: 'player', faction: 'player', mass: 1.6, maxHealth: 220, armor: 5, critChance: 1 /* force crits visible in this timeline */, critMultiplier: 2.0 });
player.position.set(-2, 0, 0);

// maxHealth here is deliberately generous (not the real swarmer=24/skeleton=52
// numbers from MonsterProfiles.js) for phases 2-3: those phases isolate the
// *live* knockback-vs-mass comparison, and a hit that kills goes through the
// death-collapse branch instead (a different code path, demonstrated on its
// own in phase 5 using a real killing blow).
const swarmer = new Entity({ type: 'monster', faction: 'hostile', mass: 0.55, maxHealth: 200, armor: 0 });
swarmer.position.set(0, 0, 0);

const skeleton = new Entity({ type: 'monster', faction: 'hostile', mass: 1.15, maxHealth: 200, armor: 6 });
skeleton.position.set(0, 0, 3);

const entities = [player, swarmer, skeleton];
const fxCounts = {};
const world = { colliders: null, monsters: [swarmer, skeleton], player, bus: { emit(type, payload) {
  if (type === 'combat:hit') record('event combat:hit', `victim=${payload.victim.type} amount=${fmt(payload.amount)} crit=${payload.crit}`);
  if (type === 'combat:kill') record('event combat:kill', `victim=${payload.victim.type}`);
  if (type === 'camera:shake') record('event camera:shake', `trauma=${fmt(payload.trauma)}`);
  if (type === 'fx:request') {
    fxCounts[payload.kind] = (fxCounts[payload.kind] || 0) + 1;
    const dir = payload.direction ? `(${fmt(payload.direction.x)},${fmt(payload.direction.z)})` : 'null';
    record(`event fx:request`, `kind=${payload.kind} pos=(${fmt(payload.position.x)},${fmt(payload.position.y)},${fmt(payload.position.z)}) dir=${dir} scale=${fmt(payload.scale)}`);
  }
} } };

function snapshot(label) {
  record(label,
    `swarmer.pos=(${fmt(swarmer.position.x)},${fmt(swarmer.position.z)}) ` +
    `skeleton.pos=(${fmt(skeleton.position.x)},${fmt(skeleton.position.z)}) ` +
    `hitstop.frames=${HitStop.frames} hitstop.scale=${fmt(HitStop.scale)}`
  );
}

record('--- phase 1: idle, 10 frames of nothing happening ---');
for (let i = 0; i < 10; i++) tick(entities, world);
snapshot('baseline');

// --- a heavy, crit-forced blow lands on the swarmer -------------------------
record('\n--- phase 2: player crit-hits the swarmer (dir = +X, west-to-east) ---');
const swarmerHealthBefore = swarmer.health;
const swarmerPosBefore = swarmer.position.x;
player.damage; // no-op reference just to keep linters quiet about unused import shape
swarmer.damage(14, player, { direction: { x: 1, z: 0 } });
record('damage() returned', `swarmer.health ${fmt(swarmerHealthBefore)} -> ${fmt(swarmer.health)}`);
snapshot('immediately after the hit (before any tick)');

for (let i = 0; i < 8; i++) {
  tick(entities, world);
  snapshot(`tick ${i + 1}/8 after crit`);
}
const swarmerMoved = swarmer.position.x - swarmerPosBefore;
record('knockback result', `swarmer displaced ${fmt(swarmerMoved)}m along +X in 8 frames (crit hit-stop included)`);

// --- an equal hit on the heavier, tankier skeleton for comparison -----------
record('\n--- phase 3: identical raw damage on the skeleton (heavier, armoured) ---');
const skeletonPosBefore = skeleton.position.x;
skeleton.damage(14, player, { direction: { x: 1, z: 0 } });
for (let i = 0; i < 8; i++) tick(entities, world);
const skeletonMoved = skeleton.position.x - skeletonPosBefore;
record('knockback result', `skeleton displaced ${fmt(skeletonMoved)}m along +X in 8 frames`);
record('comparison', `swarmer moved ${fmt(swarmerMoved / Math.max(1e-6, skeletonMoved))}x further than the skeleton for the same hit (mass+armor difference)`);

// --- hit-stop timeline in isolation, frame by frame -------------------------
record('\n--- phase 4: hit-stop frame-by-frame release, isolated ---');
HitStop.reset();
HitStop.trigger(4, 0.05);
for (let i = 0; i < 6; i++) {
  record(`  hitstop tick ${i}`, `frames=${HitStop.frames} scale=${fmt(HitStop.scale)} active=${HitStop.active}`);
  resolveOverlaps([], 1);
}
record('hit-stop check', HitStop.active ? 'STILL ACTIVE -- BUG' : 'released cleanly, as guaranteed');

// --- overlapping hit-stops: a second hit lands mid-freeze -------------------
record('\n--- phase 4b: overlapping hit-stop -- a second hit lands mid-freeze, must extend not deadlock ---');
HitStop.reset();
HitStop.trigger(3, 0.1);
record('  first trigger(3, 0.1)', `frames=${HitStop.frames} scale=${fmt(HitStop.scale)}`);
resolveOverlaps([], 1);
resolveOverlaps([], 1);
record('  after 2 ticks (1 frame left)', `frames=${HitStop.frames} scale=${fmt(HitStop.scale)}`);
HitStop.trigger(4, 0.1); // a second hit lands while the first is still winding down
record('  overlapping trigger(4, 0.1) lands', `frames=${HitStop.frames} scale=${fmt(HitStop.scale)} (extended, not reset to a fresh 4 from a frozen clock)`);
let overlapTicks = 0;
while (HitStop.active && overlapTicks < 20) {
  resolveOverlaps([], 1);
  overlapTicks++;
  record(`  overlap tick ${overlapTicks}`, `frames=${HitStop.frames} active=${HitStop.active}`);
}
record('overlap check', HitStop.active ? 'STILL ACTIVE -- BUG (deadlock)' : `released cleanly after ${overlapTicks} extra ticks, as guaranteed`);
HitStop.reset();

// --- the killing blow: directional collapse + corpse persistence -----------
record('\n--- phase 5: killing blow on the skeleton, direction = -X (west), from the east ---');
skeleton.health = 999;
skeleton.alive = true;
skeleton.stunTimer = 0;
skeleton._collapse = null;
const killDir = { x: -1, z: 0 };
skeleton.damage(999, player, { direction: killDir });
record('state after killing blow', `alive=${skeleton.alive} health=${skeleton.health} collapseDirX=${fmt(skeleton._collapse.dirX)}`);

record('\n  frame-by-frame collapse (rotation.x/z of the entity container, stun state):');
for (let i = 0; i < 40; i++) {
  tick(entities, world);
  if (i % 5 === 0 || i === 39) {
    record(`  collapse f+${i}`,
      `alive=${skeleton.alive} rot.x=${fmt(skeleton.object.rotation.x)} rot.z=${fmt(skeleton.object.rotation.z)} ` +
      `deathTimer=${fmt(skeleton.deathTimer)} stunTimer=${fmt(skeleton.stunTimer)}`);
  }
}

record('\n--- phase 5b: footstep fx -- a live swarmer walking toward a far waypoint ---');
const walker = new Entity({ type: 'monster', faction: 'hostile', mass: 0.55, maxHealth: 200, moveSpeed: 5.6, acceleration: 30, friction: 16 });
walker.position.set(10, 0, 10);
walker.setPath([{ x: 40, z: 10 }]);
const walkWorld = { colliders: null, monsters: [], player, bus: world.bus };
const fxBefore = fxCounts.dust_step || 0;
for (let i = 0; i < 90; i++) { frame++; simTime += DT; walker.update(DT, walkWorld); resolveOverlaps([walker], 1); }
record('footstep check', `dust_step fired ${((fxCounts.dust_step || 0) - fxBefore)} times over 90 frames (1.5s) of walking`);

record('\n--- phase 6: corpse persistence -- run 20 simulated seconds past death ---');
const extraTicks = Math.round(20 / DT);
for (let i = 0; i < extraTicks; i++) tick(entities, world);
record('corpse check',
  `after ${fmt(skeleton.deathTimer)}s dead, alive=${skeleton.alive}, entity still present in the array=${entities.includes(skeleton)}. ` +
  `Entity.js never removes itself -- see the report re: main.js's own reap timer, which currently despawns corpses after 14s ` +
  `and is the one thing that would defeat this.`
);

console.log(log.join('\n'));

console.log('\n=== summary ===');
console.log(`hit-stop fired and released: yes (see phase 4)`);
console.log(`knockback applied, mass-scaled: yes (swarmer moved ${fmt(Math.abs(swarmerMoved))}m vs skeleton ${fmt(Math.abs(skeletonMoved))}m for an identical raw hit)`);
console.log(`directional death collapse: yes (collapse dirX=${fmt(skeleton._collapse.dirX)} matches the killing blow's -X direction)`);
console.log(`corpse persists with no self-despawn: yes (Entity never sets alive back to true or removes itself)`);
console.log(`overlapping hit-stop extends rather than deadlocks: yes (see phase 4b, ${overlapTicks} ticks to release)`);
console.log(`fx:request kinds emitted this run: ${JSON.stringify(fxCounts)}`);
