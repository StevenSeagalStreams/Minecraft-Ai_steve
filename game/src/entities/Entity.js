import * as THREE from 'three';
import { Animator } from './Animation.js';

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

  damage(amount, source = null, opts = {}) {
    if (!this.alive) return 0;
    const dealt = Math.max(0, amount);
    this.health -= dealt;
    if (this.animator && opts.direction) this.animator.hit(opts.direction, opts.stagger ?? 0.6);
    if (opts.stun) this.stunTimer = Math.max(this.stunTimer, opts.stun);
    if (this.health <= 0) {
      this.health = 0;
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

  kill() {
    if (!this.alive) return;
    this.alive = false;
    this.deathTimer = 0;
    this.clearPath();
    this.velocity.set(0, 0, 0);
    this.animator?.die();
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
    if (!this.alive) {
      this.deathTimer += dt;
      this.animator?.update(dt, { speed: 0, facing: this.facing });
      return;
    }

    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      this._desired.set(0, 0, 0);
    } else {
      this._followPath(dt);
    }

    // --- velocity integration ----------------------------------------------
    const target = this._tmp.copy(this._desired).multiplyScalar(this.moveSpeed);
    const accel = this._desired.lengthSq() > 0.0001 ? this.acceleration : this.friction;
    const dv = target.sub(this.velocity);
    const maxDelta = accel * dt;
    if (dv.lengthSq() > maxDelta * maxDelta) dv.setLength(maxDelta);
    this.velocity.add(dv);
    this.velocity.y = 0;

    // knockback decays fast; it is an impulse, not a state
    if (this.knockback.lengthSq() > 0.0001) {
      this.velocity.add(this.knockback);
      this.knockback.multiplyScalar(Math.exp(-9 * dt));
    }

    // --- collision-aware move ----------------------------------------------
    const nx = this.position.x + this.velocity.x * dt;
    const nz = this.position.z + this.velocity.z * dt;
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
    const turn = THREE.MathUtils.clamp(diff, -this.turnRate * dt, this.turnRate * dt);
    this.facing += turn;
    this.object.rotation.y = this.facing;

    this.animator?.update(dt, { speed: this.speed, facing: this.facing });
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
 */
export function resolveOverlaps(entities, iterations = 2) {
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
