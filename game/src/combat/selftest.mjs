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
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('Failures:', failures.join(', '));
  process.exit(1);
}
