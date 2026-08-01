import * as THREE from 'three';
import { Entity } from './Entity.js';
import { buildWarrior, buildSword } from './Models.js';

/**
 * The player character.
 *
 * Input model follows the genre: left-click moves, left-click on a hostile
 * attacks, holding left-click re-issues the order each frame. Force-stand
 * (shift) attacks in place. The critical detail is the *attack lunge*: when
 * the target is just out of reach, the character steps in rather than
 * refusing to swing, which is what makes melee feel responsive.
 */
export class Player extends Entity {
  constructor(opts = {}) {
    super({
      type: 'player',
      faction: 'player',
      radius: 0.42,
      height: 1.9,
      mass: 1.6,
      moveSpeed: 5.0,
      acceleration: 42,
      friction: 34,
      maxHealth: 220,
      armor: 5,
      critChance: 0.12,
      critMultiplier: 2.0,
      ...opts,
    });

    const { rig, materials } = buildWarrior({ height: this.height, build: 1.18 });
    this.setRig(rig, { strideLength: 1.25, bounce: 1.0, weight: 1.25 });
    this.materials = materials;

    this.weapon = buildSword({ materials });
    // Grip pose: the blade points up-forward out of the fist, not straight
    // down the arm axis.
    this.weapon.rotation.set(-Math.PI * 0.52, 0, 0.12);
    this.weapon.position.set(0, -0.06, 0.02);
    rig.bones.handR.add(this.weapon);

    this.attackRange = opts.attackRange ?? 2.25;
    this.attackDuration = opts.attackDuration ?? 0.62;
    this.attackCooldown = 0;

    this.maxMana = opts.maxMana ?? 90;
    this.mana = this.maxMana;
    this.manaRegen = 3.2;
    this.healthRegen = 0.6;

    this.level = 1;
    this.experience = 0;

    /** @type {Entity|null} */
    this.target = null;
    this.moveOrder = null;

    this._tmpDir = new THREE.Vector3();
  }

  /** Issue a move order to a world position. */
  orderMove(worldX, worldZ, nav) {
    this.target = null;
    this.moveOrder = { x: worldX, z: worldZ };
    const p = nav.path(this.position.x, this.position.z, worldX, worldZ);
    if (p) this.setPath(p);
  }

  /** Issue an attack order against an entity. */
  orderAttack(entity, nav) {
    this.target = entity;
    this.moveOrder = null;
    if (this.distanceTo(entity) > this.attackRange * 0.85) {
      const p = nav.path(this.position.x, this.position.z, entity.position.x, entity.position.z);
      if (p) this.setPath(p);
    } else {
      this.clearPath();
    }
  }

  canAttack() {
    return this.alive && this.attackCooldown <= 0 && !this.animator.busy && this.stunTimer <= 0;
  }

  /**
   * Attack lunge: a target sitting just past comfortable range still gets
   * closed on and hit, rather than the swing whiffing or the order silently
   * refusing. Combat readability lives and dies on this -- a click that
   * visibly doesn't connect reads as broken input, not as "out of range".
   * This is a direct, decaying velocity nudge (reuses the knockback impulse
   * channel) rather than a teleport, so it still looks like a real step.
   */
  _lungeToward(target) {
    if (!target || !target.alive) return;
    const d = this.distanceTo(target);
    const gap = d - this.attackRange * 0.55;
    if (gap <= 0) return;
    const lunge = Math.min(gap, this.attackRange * 0.55);
    const dx = target.position.x - this.position.x;
    const dz = target.position.z - this.position.z;
    const len = Math.hypot(dx, dz) || 1;
    this.knockback.x += (dx / len) * lunge * 9;
    this.knockback.z += (dz / len) * lunge * 9;
  }

  /** @param onImpact called at the frame the blade should connect */
  attack(onImpact) {
    if (!this.canAttack()) return false;
    this.attackCooldown = this.attackDuration * 0.92;
    this._lungeToward(this.target);
    this.animator.play('attackSwing', this.attackDuration, {
      events: [{ at: 0.42, name: 'impact' }, { at: 0.30, name: 'whoosh' }],
      onEvent: (name) => onImpact?.(name),
    });
    return true;
  }

  update(dt, world) {
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    if (this.alive) {
      this.mana = Math.min(this.maxMana, this.mana + this.manaRegen * dt);
      this.health = Math.min(this.maxHealth, this.health + this.healthRegen * dt);
    }

    // Re-path toward a moving target, but only when it has drifted far enough
    // to matter -- repathing every frame burns CPU and produces jitter.
    if (this.target && this.target.alive) {
      const d = this.distanceTo(this.target);
      if (d <= this.attackRange) {
        this.clearPath();
        this.faceTowards(this.target.position.x, this.target.position.z);
      } else if (!this.path || this.pathIndex >= this.path.length - 1) {
        const p = world.nav?.path(
          this.position.x, this.position.z,
          this.target.position.x, this.target.position.z
        );
        if (p) this.setPath(p);
      }
    } else if (this.target && !this.target.alive) {
      this.target = null;
    }

    super.update(dt, world);
  }
}
