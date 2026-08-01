import * as THREE from 'three';
import { Animator } from './Animation.js';
import { computeDamage } from '../combat/Damage.js';
import { knockbackForce } from '../combat/Knockback.js';
import { HitStop } from '../combat/HitStop.js';

let _nextId = 1;

/**
 * Base actor: transform, stats, steering, path following, collision response.
 *
 * Movement is force-free (no rigid body integration). ARPG feel comes from
 * direct velocity control with acceleration limits -- physics-driven movement
 * gives you ice-skating and makes precise melee spacing impossible.
 */
export class Entity {
  constructor(opts = {}) {
    this.id = _nextId++;
    this.type = opts.type ?? 'entity';
    this.faction = opts.faction ?? 'neutral';

    this.object = new THREE.Group();
    this.object.name = `${this.type}#${this.id}`;

    this.position = this.object.position;
    this.velocity = new THREE.Vector3();
    this.facing = 0;              // yaw, radians
    this.targetFacing = 0;
    this.turnRate = opts.turnRate ?? 11.0;

    this.radius = opts.radius ?? 0.42;
    this.height = opts.height ?? 1.85;
    this.mass = opts.mass ?? 1.0;

    this.moveSpeed = opts.moveSpeed ?? 4.4;
    this.acceleration = opts.acceleration ?? 34.0;
    this.friction = opts.friction ?? 26.0;

    this.maxHealth = opts.maxHealth ?? 100;
    this.health = this.maxHealth;
    this.alive = true;
    this.deathTimer = 0;

    // Combat stats. Physical damage, armour reduction and crits are all
    // resolved centrally in damage() via src/combat/Damage.js -- these are
    // just the per-entity inputs to that one auditable formula.
    this.armor = opts.armor ?? 0;
    this.critChance = opts.critChance ?? 0;
    this.critMultiplier = opts.critMultiplier ?? 1.5;

    /** Cached from the most recent update(dt, world) call. damage() can be
     *  invoked outside of update() (e.g. from an attack's onImpact callback
     *  earlier in the same frame), so this is refreshed every tick rather
     *  than captured once at construction time. */
    this._world = null;
    /** Directional, varied death collapse -- see kill(). */
    this._collapse = null;

    /** @type {{x:number,z:number}[]|null} */
    this.path = null;
    this.pathIndex = 0;
    this.arriveRadius = opts.arriveRadius ?? 0.30;

    this.rig = null;
    this.animator = null;

    this.stunTimer = 0;
    this.knockback = new THREE.Vector3();

    this._desired = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
  }

  setRig(rig, animOpts = {}) {
    this.rig = rig;
    this.object.add(rig.root);
    this.animator = new Animator(rig, animOpts);
    return this;
  }

  get speed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  setPath(waypoints) {
    this.path = waypoints && waypoints.length ? waypoints : null;
    this.pathIndex = 0;
  }

  clearPath() {
    this.path = null;
    this.pathIndex = 0;
  }

  faceTowards(x, z) {
    this.targetFacing = Math.atan2(x - this.position.x, z - this.position.z);
  }

  applyKnockback(dirX, dirZ, force) {
    const inv = 1 / Math.max(0.2, this.mass);
    this.knockback.x += dirX * force * inv;
    this.knockback.z += dirZ * force * inv;
  }

  /**
   * The one auditable place damage is computed and applied. Every hit in the
   * game -- player swinging on a monster, a monster swinging on the player --
   * ends up calling `victim.damage(rawAmount, attacker, opts)`, so armour
   * reduction (victim.armor), crit rolls (attacker.critChance/Multiplier),
   * knockback (mass-scaled), hit-stop, camera shake and the `combat:hit`
   * event all happen exactly once, right here, regardless of which call site
   * triggered it. See computeDamage() in src/combat/Damage.js for the actual
   * math and its self-test for the guarantees (no NaN, bounded armour).
   */
  damage(amount, source = null, opts = {}) {
    if (!this.alive) return 0;

    const rngFn = (this._world && this._world.rng && typeof this._world.rng.next === 'function')
      ? () => this._world.rng.next()
      : Math.random;

    const result = computeDamage({
      baseAmount: amount,
      armor: this.armor,
      critChance: source?.critChance ?? 0,
      critMultiplier: source?.critMultiplier ?? this.critMultiplier,
      forceCrit: typeof opts.crit === 'boolean' ? opts.crit : undefined,
      rng: rngFn,
    });

    const dealt = result.amount;
    this.health = Math.max(0, this.health - dealt);

    if (opts.direction) {
      const force = knockbackForce(dealt, { crit: result.crit, flat: opts.knockback ?? 0 });
      this.applyKnockback(opts.direction.x, opts.direction.z, force);
    }
    if (this.animator && opts.direction) {
      const strength = result.crit
        ? 1
        : Math.min(1, 0.35 + (dealt / Math.max(1, this.maxHealth)) * 1.8);
      this.animator.hit(opts.direction, opts.stagger ?? strength);
    }
    if (opts.stun) this.stunTimer = Math.max(this.stunTimer, opts.stun);

    // Hit-stop: the single highest-leverage trick for melee to read as
    // connecting. Crits freeze harder and longer; a merely "heavy" hit (a big
    // chunk of the victim's max health in one blow) gets a shorter, lighter
    // slow. Both numbers are in real frames -- see HitStop.js for why that
    // guarantees release.
    const heavyFrac = this.maxHealth > 0 ? dealt / this.maxHealth : 0;
    if (result.crit) HitStop.trigger(5, 0.04);
    else if (heavyFrac >= 0.16) HitStop.trigger(3, 0.15);

    // Camera feedback. `world.bus` is the documented channel; `window.__game`
    // is the mission-specified fallback straight to the rig's own trauma
    // accumulator, since `world` does not carry a reference to the rig.
    if (result.crit || heavyFrac >= 0.12) {
      const trauma = Math.min(1, (result.crit ? 0.22 : 0.10) + heavyFrac * 0.3);
      this._world?.bus?.emit?.('camera:shake', { trauma });
      if (typeof window !== 'undefined') {
        try { window.__game?.rig?.addTrauma?.(trauma); } catch { /* non-browser/headless: no-op */ }
      }
    }

    this._world?.bus?.emit?.('combat:hit', {
      attacker: source, victim: this, amount: dealt, direction: opts.direction ?? null, crit: result.crit,
    });

    if (this.health <= 0) {
      this.health = 0;
      this._deathDirection = opts.direction ? { x: opts.direction.x, z: opts.direction.z } : null;
      this._deathForce = dealt;
      this.kill(source);
    }
    return dealt;
  }

  heal(amount) {
    if (!this.alive) return 0;
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    return this.health - before;
  }

  /**
   * Not literal rigid-body ragdoll -- a directional, varied tip-over of the
   * whole entity container, layered on top of whatever Animation.js's own
   * `_poseDeath` does to individual bones (we do not own Animation.js, so
   * this happens one level up: `this.object` is the group Entity itself
   * owns, and `rig.root` is just a child of it, so the two transforms
   * compose). A body killed by a hit from the left falls to the right,
   * because the tip direction comes straight from the killing blow's
   * direction; force and a little randomness vary how hard/fast it goes.
   */
  kill(source = null) {
    if (!this.alive) return;
    this.alive = false;
    this.deathTimer = 0;
    this.clearPath();
    this.velocity.set(0, 0, 0);
    this.animator?.die();

    const dir = this._deathDirection;
    const forceFrac = THREE.MathUtils.clamp(
      (this._deathForce ?? 0) / Math.max(1, this.maxHealth * 0.5), 0.35, 1.6
    );
    this._collapse = {
      // Fall away from the blow; if we don't know a direction (e.g. a scripted
      // kill with no hit direction), fall forward along current facing.
      dirX: dir ? dir.x : Math.sin(this.facing),
      dirZ: dir ? dir.z : Math.cos(this.facing),
      twist: (Math.random() - 0.5) * 0.6,
      amount: THREE.MathUtils.clamp(0.95 + forceFrac * 0.3 + Math.random() * 0.25, 0.85, 1.5),
      duration: THREE.MathUtils.clamp(0.9 - forceFrac * 0.25 + Math.random() * 0.2, 0.45, 1.0),
    };

    // Diablo rule: corpses persist. This entity does not despawn itself on a
    // timer -- see the note in the mission report about main.js's reaper.
    this._world?.bus?.emit?.('combat:kill', { attacker: source, victim: this });
  }

  /** Steering toward the current path waypoint. Returns desired velocity. */
  _followPath(dt) {
    this._desired.set(0, 0, 0);
    if (!this.path) return this._desired;

    let wp = this.path[this.pathIndex];
    while (wp) {
      const dx = wp.x - this.position.x;
      const dz = wp.z - this.position.z;
      const distSq = dx * dx + dz * dz;
      // The final waypoint gets a tighter arrival radius; intermediate ones
      // can be cut generously, which is what makes corners look smooth.
      const isLast = this.pathIndex === this.path.length - 1;
      const r = isLast ? this.arriveRadius : Math.max(this.arriveRadius, this.radius * 1.2);
      if (distSq <= r * r) {
        this.pathIndex++;
        wp = this.path[this.pathIndex];
        if (!wp) { this.clearPath(); return this._desired; }
        continue;
      }

      const dist = Math.sqrt(distSq);
      this._desired.set(dx / dist, 0, dz / dist);
      // Arrival damping on the last leg only, so we do not crawl through
      // every intermediate corner.
      if (isLast && dist < 1.4) this._desired.multiplyScalar(Math.max(0.25, dist / 1.4));
      this.targetFacing = Math.atan2(dx, dz);
      return this._desired;
    }
    return this._desired;
  }

  update(dt, world) {
    this._world = world;

    if (!this.alive) {
      this.deathTimer += dt;
      this.animator?.update(dt, { speed: 0, facing: this.facing });
      if (this._collapse) {
        const c = this._collapse;
        const t = Math.min(1, this.deathTimer / c.duration);
        const e = 1 - Math.pow(1 - t, 3); // ease-out settle
        this.object.rotation.x = c.dirZ * c.amount * e;
        this.object.rotation.z = -c.dirX * c.amount * e;
        this.object.rotation.y = this.facing + c.twist * e;
      }
      return;
    }

    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      this._desired.set(0, 0, 0);
    } else {
      this._followPath(dt);
    }

    // Hit-stop scales physics AND animation together, in this one place --
    // that is the whole trick. Status timers above (stun) intentionally keep
    // running in real time; only motion and the animator's own clock freeze.
    const hitStopScale = HitStop.scale;
    const sdt = dt * hitStopScale;

    // --- velocity integration ----------------------------------------------
    const target = this._tmp.copy(this._desired).multiplyScalar(this.moveSpeed);
    const accel = this._desired.lengthSq() > 0.0001 ? this.acceleration : this.friction;
    const dv = target.sub(this.velocity);
    const maxDelta = accel * sdt;
    if (dv.lengthSq() > maxDelta * maxDelta) dv.setLength(maxDelta);
    this.velocity.add(dv);
    this.velocity.y = 0;

    // knockback decays fast; it is an impulse, not a state
    if (this.knockback.lengthSq() > 0.0001) {
      this.velocity.add(this.knockback);
      this.knockback.multiplyScalar(Math.exp(-9 * sdt));
    }

    // --- collision-aware move ----------------------------------------------
    const nx = this.position.x + this.velocity.x * sdt;
    const nz = this.position.z + this.velocity.z * sdt;
    const colliders = world?.colliders;

    if (colliders) {
      // Axis-separated resolution lets the body slide along walls instead of
      // sticking. Sticking on corners is the number one thing that makes
      // click-to-move feel broken.
      if (!colliders.isBlocked(nx, this.position.z, this.radius)) {
        this.position.x = nx;
      } else {
        this.velocity.x *= -0.05;
      }
      if (!colliders.isBlocked(this.position.x, nz, this.radius)) {
        this.position.z = nz;
      } else {
        this.velocity.z *= -0.05;
      }
    } else {
      this.position.x = nx;
      this.position.z = nz;
    }

    // --- facing --------------------------------------------------------------
    let diff = this.targetFacing - this.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turn = THREE.MathUtils.clamp(diff, -this.turnRate * sdt, this.turnRate * sdt);
    this.facing += turn;
    this.object.rotation.y = this.facing;

    this.animator?.update(sdt, { speed: this.speed, facing: this.facing });
  }

  distanceTo(other) {
    const dx = other.position.x - this.position.x;
    const dz = other.position.z - this.position.z;
    return Math.hypot(dx, dz);
  }

  dispose() {
    this.rig?.dispose();
    this.object.removeFromParent();
  }
}

/**
 * Separation steering so a pack of monsters does not converge into one
 * flickering z-fighting pile at the player's feet.
 *
 * main.js calls this exactly once per real frame (it is the load-bearing
 * "overlap resolution" phase in the fixed update order), which makes it the
 * one safe place to burn a single frame off the global hit-stop counter --
 * see HitStop.js for why that guarantees the freeze always releases.
 */
export function resolveOverlaps(entities, iterations = 2) {
  HitStop.tickFrame();
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < entities.length; i++) {
      const a = entities[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < entities.length; j++) {
        const b = entities[j];
        if (!b.alive) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const minDist = a.radius + b.radius;
        const dSq = dx * dx + dz * dz;
        if (dSq >= minDist * minDist || dSq < 1e-8) continue;
        const d = Math.sqrt(dSq);
        const push = (minDist - d) * 0.5;
        const ux = dx / d, uz = dz / d;
        // Heavier bodies shove lighter ones; a boss should not be jostled by
        // the fodder around it.
        const total = a.mass + b.mass;
        const aShare = b.mass / total;
        const bShare = a.mass / total;
        a.position.x -= ux * push * 2 * aShare;
        a.position.z -= uz * push * 2 * aShare;
        b.position.x += ux * push * 2 * bShare;
        b.position.z += uz * push * 2 * bShare;
      }
    }
  }
}
