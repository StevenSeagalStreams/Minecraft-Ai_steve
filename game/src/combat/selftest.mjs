#!/usr/bin/env node
/**
 * Plain-node self-test for the combat pillar. No browser, no THREE renderer,
 * no harness -- run with:
 *
 *   node src/combat/selftest.mjs
 *
 * Entity.js only depends on THREE's CPU-side math classes (Vector3, Group,
 * MathUtils) and Animation.js (also pure), so real Entity instances can be
 * constructed and driven here without a rig/canvas/WebGL context. This tests
 * the actual production code, not a reimplementation of it.
 */
import * as THREE from 'three';
import { Entity, resolveOverlaps } from '../entities/Entity.js';
import { armorReduction, computeDamage, DAMAGE_TUNING } from './Damage.js';
import { knockbackForce } from './Knockback.js';
import { HitStop, HITSTOP_MAX_FRAMES } from './HitStop.js';
import { committedAttackers, canCommitToAttack, propagateAggro } from './AggroPack.js';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL ${name}`);
  }
}

function isCleanNumber(n) {
  return typeof n === 'number' && Number.isFinite(n) && !Number.isNaN(n);
}

// ---------------------------------------------------------------------------
console.log('\n[1] damage never produces NaN, across adversarial inputs');
// ---------------------------------------------------------------------------
{
  const adversarial = [
    { baseAmount: 0 },
    { baseAmount: -50 },
    { baseAmount: NaN },
    { baseAmount: Infinity },
    { baseAmount: 20, armor: NaN },
    { baseAmount: 20, armor: -100 },
    { baseAmount: 20, armor: Infinity },
    { baseAmount: 20, critChance: NaN },
    { baseAmount: 20, critChance: -5 },
    { baseAmount: 20, critChance: 5 },
    { baseAmount: 20, critMultiplier: NaN },
    { baseAmount: 20, critMultiplier: -3 },
    { baseAmount: 20, critChance: 1, critMultiplier: 0 },
    { baseAmount: undefined },
    { baseAmount: null },
    {},
  ];
  let allClean = true;
  for (const input of adversarial) {
    const r = computeDamage(input);
    if (!isCleanNumber(r.amount) || r.amount < 0) {
      allClean = false;
      console.log('    bad result for', input, '->', r);
    }
  }
  check('computeDamage(...) is always a finite, non-negative number', allClean);

  // rollCrit with a garbage rng (returns NaN/undefined) must not crash and
  // must not silently always-crit.
  const weirdRng = () => NaN;
  const r2 = computeDamage({ baseAmount: 30, critChance: 0.5, rng: weirdRng });
  check('computeDamage tolerates a broken rng function', isCleanNumber(r2.amount));
}

// ---------------------------------------------------------------------------
console.log('\n[2] armour reduction is monotonic and bounded');
// ---------------------------------------------------------------------------
{
  const samples = [0, 1, 2, 5, 10, 20, 45, 80, 150, 400, 1000, 1e6];
  let monotonic = true;
  let bounded = true;
  let prev = -Infinity;
  for (const a of samples) {
    const r = armorReduction(a);
    if (r < prev - 1e-9) monotonic = false;
    if (r < 0 || r > DAMAGE_TUNING.MAX_ARMOR_REDUCTION + 1e-9) bounded = false;
    prev = r;
  }
  check('armorReduction(armor) is non-decreasing as armor rises', monotonic);
  check(`armorReduction(armor) never exceeds MAX_ARMOR_REDUCTION (${DAMAGE_TUNING.MAX_ARMOR_REDUCTION})`, bounded);
  check('armorReduction(0) === 0 (no free mitigation)', armorReduction(0) === 0);
  check('armorReduction handles negative/NaN armour without going negative or NaN',
    armorReduction(-50) === 0 && armorReduction(NaN) === 0);

  // Bounded reduction means armour can never fully negate a hit.
  const hit = computeDamage({ baseAmount: 100, armor: 1e9 });
  check('even absurd armour leaves some damage through', hit.amount > 0);
}

// ---------------------------------------------------------------------------
console.log('\n[3] knockback scales inversely with mass');
// ---------------------------------------------------------------------------
{
  // (a) the pure force function: same damage in, mass is not even a param --
  // it must not appear here, since Entity.applyKnockback owns the division.
  const fLight = knockbackForce(40, { crit: false });
  const fHeavy = knockbackForce(40, { crit: false });
  check('knockbackForce(damage) is deterministic for identical inputs', fLight === fHeavy);
  check('knockbackForce(0 damage) is not negative', knockbackForce(0) >= 0);
  check('knockbackForce never returns NaN for garbage input', isCleanNumber(knockbackForce(NaN, { flat: NaN })));

  // (b) end-to-end through the real Entity/applyKnockback pipeline: a light
  // body (swarmer-like mass) must travel further than a heavy body
  // (brute-like mass) from an identical hit.
  const light = new Entity({ mass: 0.55, maxHealth: 24 });
  const heavy = new Entity({ mass: 2.4, maxHealth: 140 });
  const dir = { x: 1, z: 0 };
  const dmg = 30;
  const force = knockbackForce(dmg, { crit: false });
  light.applyKnockback(dir.x, dir.z, force);
  heavy.applyKnockback(dir.x, dir.z, force);
  const lightKb = light.knockback.length();
  const heavyKb = heavy.knockback.length();
  check('a lighter body receives more knockback than a heavier body from an identical hit',
    lightKb > heavyKb);
  check('knockback ratio roughly tracks the inverse mass ratio (within 15%)',
    Math.abs((lightKb / heavyKb) - (2.4 / 0.55)) / (2.4 / 0.55) < 0.15);

  // (c) full pipeline through Entity#damage(): a swarmer-mass victim should
  // actually be thrown (move a meaningful distance next tick); a brute-mass
  // victim should barely shift. maxHealth here is deliberately generous (not
  // the real swarmer/skeleton numbers) so the hit is non-lethal for both --
  // a killing blow goes through the death-collapse branch instead of live
  // knockback flight, which would be a different (and already covered)
  // code path, not what this check is isolating.
  HitStop.reset();
  const swarmer = new Entity({ mass: 0.55, maxHealth: 200, armor: 0 });
  const brute = new Entity({ mass: 2.4, maxHealth: 200, armor: 0 });
  const attacker = { critChance: 0, critMultiplier: 1 };
  swarmer.damage(30, attacker, { direction: dir });
  brute.damage(30, attacker, { direction: dir });
  swarmer.update(1 / 60, { colliders: null });
  brute.update(1 / 60, { colliders: null });
  check('a heavy hit throws a low-mass body (swarmer) meaningfully',
    Math.abs(swarmer.position.x) > Math.abs(brute.position.x) * 1.5);

  // (d) knockback must be a BOUNDED shove, not an unbounded/resonant fling.
  // Regression guard for a real bug this suite's own feeltest instrumentation
  // caught: folding the decaying knockback vector permanently into `velocity`
  // every frame (instead of only contributing it to that frame's position
  // delta) compounded into a multi-second, hundreds-of-metres runaway from a
  // single crit on a light body. Run a light body for many frames after one
  // hit and check total displacement stays within a small, sane multiple of
  // the theoretical impulse bound (force/mass / decayRate), never diverging.
  HitStop.reset();
  const flungLight = new Entity({ mass: 0.55, maxHealth: 1000, armor: 0, friction: 16 });
  const flingForce = knockbackForce(30, { crit: true });
  flungLight.applyKnockback(1, 0, flingForce);
  const theoreticalBound = (flingForce / Math.max(0.2, flungLight.mass)) / 9; // matches the 9 in Entity's decay
  for (let i = 0; i < 300; i++) flungLight.update(1 / 60, { colliders: null }); // 5 simulated seconds
  check(`a single knockback impulse produces a bounded total displacement (got ${flungLight.position.x.toFixed(2)}m, bound ~${theoreticalBound.toFixed(2)}m)`,
    flungLight.position.x < theoreticalBound * 3 && flungLight.position.x < 15);
  // Entity.js stops multiplying the knockback vector once it's already below
  // the "may as well be zero" epsilon guard (lengthSq < 0.0001, i.e. length
  // < 0.01) rather than paying to decay an already-imperceptible residual
  // forever -- so it settles just under that epsilon, not at exact 0.
  check('knockback decays down to (and stays at) a negligible, imperceptible residual',
    flungLight.knockback.length() < 0.01);
}

// ---------------------------------------------------------------------------
console.log('\n[4] hit-stop always releases, never permanently freezes the sim');
// ---------------------------------------------------------------------------
{
  HitStop.reset();
  check('HitStop starts released (scale 1, inactive)', HitStop.scale === 1 && !HitStop.active);

  HitStop.trigger(1000, 0); // pathological: someone asks for a 1000-frame hard freeze
  check(`trigger() clamps an absurd request to HITSTOP_MAX_FRAMES (${HITSTOP_MAX_FRAMES})`,
    HitStop.frames === HITSTOP_MAX_FRAMES);
  check('a hard freeze (factor 0) reads as fully frozen this frame', HitStop.scale === 0);

  let framesBurned = 0;
  const budget = HITSTOP_MAX_FRAMES + 5; // deliberately tick past the theoretical max
  while (HitStop.active && framesBurned < budget) {
    HitStop.tickFrame();
    framesBurned++;
  }
  check(`released within HITSTOP_MAX_FRAMES real ticks (took ${framesBurned})`,
    framesBurned <= HITSTOP_MAX_FRAMES);
  check('scale returns to 1 after release', HitStop.scale === 1);
  check('active is false after release', !HitStop.active);

  // A weaker request must never cut a stronger one short.
  HitStop.reset();
  HitStop.trigger(5, 0.04); // crit-tier freeze
  HitStop.trigger(1, 0.5);  // a trivial hit landing the same frame
  check('a weaker/shorter request does not shorten an in-flight freeze', HitStop.frames === 5);

  // Overlapping hit-stops (e.g. a cleave that lands on two monsters the same
  // frame, or a second hit landing mid-freeze) must EXTEND the freeze, not
  // deadlock the counter or get lost. Prove this two ways: (a) a longer
  // request arriving mid-freeze pushes the release further out than either
  // request alone would have, and (b) hammering trigger() every single frame
  // -- the worst-case "does this ever stop counting down" scenario -- still
  // releases within a bounded number of frames after the requests stop.
  HitStop.reset();
  HitStop.trigger(3, 0.1);
  HitStop.tickFrame();               // 1 frame burned -> 2 left
  HitStop.tickFrame();               // 2 frames burned -> 1 left
  check('mid-extend setup: 1 frame left before the overlapping trigger', HitStop.frames === 1);
  HitStop.trigger(4, 0.1);           // a second, overlapping hit lands now
  check('an overlapping request extends the freeze past where the first alone would have ended',
    HitStop.frames === 4);
  let extendBurned = 0;
  while (HitStop.active && extendBurned < HITSTOP_MAX_FRAMES + 5) { HitStop.tickFrame(); extendBurned++; }
  check('the extended freeze still releases within HITSTOP_MAX_FRAMES of its own extension',
    extendBurned <= HITSTOP_MAX_FRAMES && !HitStop.active);

  HitStop.reset();
  // Worst case: something buggy re-triggers hit-stop every single frame for a
  // while (e.g. a pack all landing hits on consecutive frames). The frame
  // counter is clamped on every write, so this can never accumulate into an
  // unbounded or permanent freeze -- it must still fully drain soon after the
  // spam stops.
  for (let i = 0; i < 50; i++) { HitStop.trigger(5, 0.05); HitStop.tickFrame(); }
  check('hammering trigger() every frame for 50 frames never exceeds HITSTOP_MAX_FRAMES',
    HitStop.frames <= HITSTOP_MAX_FRAMES);
  let drainBurned = 0;
  while (HitStop.active && drainBurned < HITSTOP_MAX_FRAMES + 5) { HitStop.tickFrame(); drainBurned++; }
  check('once the spam stops, the sim is not permanently frozen -- it drains and releases',
    drainBurned <= HITSTOP_MAX_FRAMES && !HitStop.active);
  HitStop.reset();

  // Entity.update()/resolveOverlaps() integration: with hit-stop hard-frozen,
  // an entity with velocity should barely move, and resolveOverlaps() (which
  // is the one place that ticks the frame counter) must still burn it down.
  HitStop.reset();
  HitStop.trigger(3, 0);
  const e = new Entity({ mass: 1, moveSpeed: 10, acceleration: 1000, friction: 1000 });
  e.velocity.set(5, 0, 0);
  const before = e.position.x;
  e.update(1 / 60, { colliders: null });
  const movedWhileFrozen = Math.abs(e.position.x - before);
  resolveOverlaps([], 1); // burns 1 frame, same call main.js makes every tick
  e.update(1 / 60, { colliders: null });
  resolveOverlaps([], 1);
  e.update(1 / 60, { colliders: null });
  resolveOverlaps([], 1); // 3rd tick -> hit-stop should be released now
  check('position barely advances during a hard freeze (< 10% of unfrozen distance)',
    movedWhileFrozen < (5 * (1 / 60)) * 0.1);
  check('HitStop released after exactly the requested number of resolveOverlaps() calls',
    !HitStop.active);
  HitStop.reset();
}

// ---------------------------------------------------------------------------
console.log('\n[5] pack coordination (AggroPack) helpers');
// ---------------------------------------------------------------------------
{
  const mk = (state, x, z) => ({ state, alive: true, position: { x, z }, setState(s) { this.state = s; } });
  const a = mk('attack', 0, 0);
  const b = mk('attack', 1, 0);
  const c = mk('chase', 2, 0);
  const pack = [a, b, c];
  check('committedAttackers counts only monsters in the committed state', committedAttackers(pack) === 2);
  check('canCommitToAttack refuses a 3rd attacker when max is 2', !canCommitToAttack(c, pack, 2));
  check('canCommitToAttack allows a 3rd attacker when max is 3', canCommitToAttack(c, pack, 3));

  const source = mk('chase', 0, 0);
  const near = mk('idle', 2, 0);
  const far = mk('idle', 50, 0);
  const woken = propagateAggro(source, [source, near, far], 10);
  check('propagateAggro wakes an idle neighbour within radius', near.state === 'alert');
  check('propagateAggro leaves a distant idle monster alone', far.state === 'idle');
  check('propagateAggro returns exactly the monsters it woke', woken.length === 1 && woken[0] === near);
}

// ---------------------------------------------------------------------------
console.log('\n[6] crit multiplier applies exactly once');
// ---------------------------------------------------------------------------
{
  // Direct math check: a forced crit multiplies the mitigated damage by
  // exactly critMultiplier -- not squared, not applied to armour, not
  // applied twice by some second code path.
  const base = 40;
  const armor = 10;
  const critMultiplier = 1.75;
  const noCrit = computeDamage({ baseAmount: base, armor, critMultiplier, forceCrit: false });
  const crit = computeDamage({ baseAmount: base, armor, critMultiplier, forceCrit: true });
  const expectedMitigated = base * (1 - armorReduction(armor));
  check('a non-crit hit deals exactly the mitigated amount (multiplier 1x)',
    Math.abs(noCrit.amount - expectedMitigated) < 1e-9);
  check('a forced crit deals exactly mitigated * critMultiplier, no more, no less',
    Math.abs(crit.amount - expectedMitigated * critMultiplier) < 1e-9);
  check('crit is not "double-applied": crit.amount / noCrit.amount === critMultiplier exactly',
    Math.abs(crit.amount / noCrit.amount - critMultiplier) < 1e-9);

  // End-to-end through Entity#damage(): even with the attacker rolling a
  // guaranteed crit AND the victim's own multiplier set very differently,
  // only the attacker's critMultiplier is used, applied exactly once, and
  // the `crit` flag on the emitted combat:hit event is set exactly once.
  let hitEvents = 0;
  let lastAmount = 0;
  const bus = { emit(type, payload) { if (type === 'combat:hit') { hitEvents++; lastAmount = payload.amount; } } };
  const victim = new Entity({ maxHealth: 1000, armor: 10, critMultiplier: 99 /* must be ignored -- attacker's wins */ });
  victim._world = { bus };
  const attacker = { critChance: 1, critMultiplier: 2 };
  const dealt = victim.damage(40, attacker, { crit: true });
  const expected = 40 * (1 - armorReduction(10)) * 2;
  check('Entity#damage applies the attacker\'s crit multiplier exactly once end-to-end',
    Math.abs(dealt - expected) < 1e-6);
  check('exactly one combat:hit event is emitted per damage() call', hitEvents === 1);
  check('the emitted amount matches the returned amount (single source of truth)',
    Math.abs(lastAmount - dealt) < 1e-9);
}

// ---------------------------------------------------------------------------
console.log('\n[7] fx:request contract -- combat emits the documented vfx events');
// ---------------------------------------------------------------------------
{
  const seen = [];
  const bus = { emit(type, payload) { if (type === 'fx:request') seen.push(payload); } };

  // (a) a non-lethal hit on an unarmoured target -> blood_hit, well-shaped
  // payload, no spark, no kill.
  HitStop.reset();
  const swarmerLike = new Entity({ maxHealth: 200, armor: 0, height: 1.5 });
  swarmerLike._world = { bus };
  seen.length = 0;
  swarmerLike.damage(10, { critChance: 0 }, { direction: { x: 1, z: 0 } });
  const kinds = seen.map((e) => e.kind);
  check('a hit on an unarmoured target requests blood_hit', kinds.includes('blood_hit'));
  check('a hit on an unarmoured target does NOT request spark_metal', !kinds.includes('spark_metal'));
  for (const e of seen) {
    check(`fx:request(${e.kind}) has a well-shaped payload (position x/y/z, finite scale)`,
      isCleanNumber(e.position?.x) && isCleanNumber(e.position?.y) && isCleanNumber(e.position?.z) &&
      isCleanNumber(e.scale) && e.scale > 0);
  }

  // (b) a non-lethal hit on an armoured target -> spark_metal, not blood_hit.
  HitStop.reset();
  const skeletonLike = new Entity({ maxHealth: 200, armor: 6, height: 1.8 });
  skeletonLike._world = { bus };
  seen.length = 0;
  skeletonLike.damage(10, { critChance: 0 }, { direction: { x: 1, z: 0 } });
  const kinds2 = seen.map((e) => e.kind);
  check('a hit on an armoured target requests spark_metal, not blood_hit',
    kinds2.includes('spark_metal') && !kinds2.includes('blood_hit'));

  // (c) a heavy/crit hit also requests impact_flash, on top of the blood/spark.
  HitStop.reset();
  const critTarget = new Entity({ maxHealth: 200, armor: 0 });
  critTarget._world = { bus };
  seen.length = 0;
  critTarget.damage(20, { critChance: 0 }, { direction: { x: 1, z: 0 }, crit: true });
  const kinds3 = seen.map((e) => e.kind);
  check('a crit hit also requests impact_flash', kinds3.includes('impact_flash'));

  // (d) a killing blow requests blood_kill, with a direction matching the
  // collapse direction (the killing blow's direction).
  HitStop.reset();
  const dying = new Entity({ maxHealth: 20, armor: 0 });
  dying._world = { bus };
  seen.length = 0;
  dying.damage(999, { critChance: 0 }, { direction: { x: -1, z: 0 } });
  const killEvent = seen.find((e) => e.kind === 'blood_kill');
  check('a killing blow requests blood_kill', !!killEvent);
  check('blood_kill direction matches the killing blow\'s direction',
    killEvent && Math.sign(killEvent.direction.x) === -1);

  // (e) footstep dust: a moving entity eventually requests dust_step, a
  // stationary one never does.
  HitStop.reset();
  // NB: update(dt, world) unconditionally sets `this._world = world` at the
  // top (Entity.js needs the fresh reference every tick since damage() can
  // be invoked outside of update() too) -- so the bus has to travel in via
  // the `world` argument here, not a pre-set `_world`, or it gets clobbered.
  const walker = new Entity({ moveSpeed: 4, acceleration: 1000, friction: 1000, maxHealth: 100 });
  walker.setPath([{ x: 1000, z: 0 }]); // far waypoint -> steady desired velocity every frame
  seen.length = 0;
  for (let i = 0; i < 120; i++) walker.update(1 / 60, { colliders: null, bus }); // 2s of walking
  const steps = seen.filter((e) => e.kind === 'dust_step');
  check('a moving entity eventually requests dust_step', steps.length > 0);

  const stillEntity = new Entity({ maxHealth: 100 });
  seen.length = 0;
  for (let i = 0; i < 60; i++) stillEntity.update(1 / 60, { colliders: null, bus });
  check('a stationary entity never requests dust_step', seen.filter((e) => e.kind === 'dust_step').length === 0);

  // (f) never lets a bad direction (0-length, NaN) escape as a bad payload --
  // fx consumers should never have to defend against NaN from us.
  HitStop.reset();
  const nanDirVictim = new Entity({ maxHealth: 100, armor: 0 });
  nanDirVictim._world = { bus };
  seen.length = 0;
  nanDirVictim.damage(10, { critChance: 0 }, {}); // no direction supplied at all
  check('fx:request tolerates a hit with no direction (direction: null, not NaN)',
    seen.every((e) => e.direction === null || (isCleanNumber(e.direction.x) && isCleanNumber(e.direction.z))));
}

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('Failures:', failures.join(', '));
  process.exit(1);
}
