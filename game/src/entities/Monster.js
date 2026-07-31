import * as THREE from 'three';
import { Entity } from './Entity.js';
import { buildSkeleton } from './Models.js';

/**
 * Hostile actor with a small behaviour state machine.
 *
 * States: idle -> alert -> chase -> attack -> reposition. The reposition state
 * is the one that matters for feel: after swinging, a monster backs off and
 * circles briefly instead of standing in your face re-swinging. That single
 * behaviour is the difference between a fight with rhythm and a shoving match.
 */
export class Monster extends Entity {
  constructor(opts = {}) {
    super({
      type: 'monster',
      faction: 'hostile',
      radius: 0.38,
      height: 1.72,
      mass: 0.9,
      moveSpeed: 3.4,
      acceleration: 22,
      friction: 18,
      maxHealth: 46,
      ...opts,
    });

    const { rig, materials } = buildSkeleton({ height: this.height });
    this.setRig(rig, { strideLength: 1.05, bounce: 1.25, weight: 0.75, idleSway: 0.6 });
    this.materials = materials;

    this.state = 'idle';
    this.stateTime = 0;

    this.aggroRange = opts.aggroRange ?? 13;
    this.leashRange = opts.leashRange ?? 34;
    this.attackRange = opts.attackRange ?? 1.95;
    this.attackDamage = opts.attackDamage ?? 9;
    this.attackDuration = opts.attackDuration ?? 0.78;
    this.attackCooldown = 0;
    this.attackInterval = opts.attackInterval ?? 1.55;

    this.experienceValue = opts.experienceValue ?? 14;
    this.spawnPoint = new THREE.Vector3();

    this._repathTimer = 0;
    // Desynchronise the pack: without a per-monster offset, a group repaths on
    // the same frame and you get a visible hitch every time they all think.
    this._repathOffset = Math.random() * 0.4;
    this._circleDir = Math.random() < 0.5 ? -1 : 1;
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
  }

  update(dt, world) {
    if (!this.alive) { super.update(dt, world); return; }

    this.stateTime += dt;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    this._repathTimer -= dt;

    const player = world.player;
    const dist = player && player.alive ? this.distanceTo(player) : Infinity;

    switch (this.state) {
      case 'idle':
        if (dist < this.aggroRange) this.setState('alert');
        break;

      case 'alert':
        // A beat of hesitation before charging. Instant aggro reads as robotic;
        // a ~0.3s tell lets the player see the pack wake up.
        this.faceTowards(player.position.x, player.position.z);
        if (this.stateTime > 0.28) this.setState('chase');
        break;

      case 'chase': {
        if (dist > this.leashRange) { this.setState('idle'); this.clearPath(); break; }
        if (dist <= this.attackRange) { this.setState('attack'); this.clearPath(); break; }
        if (this._repathTimer <= 0) {
          this._repathTimer = 0.35 + this._repathOffset;
          const p = world.nav?.path(
            this.position.x, this.position.z,
            player.position.x, player.position.z
          );
          if (p) this.setPath(p);
        }
        break;
      }

      case 'attack': {
        this.clearPath();
        this.faceTowards(player.position.x, player.position.z);
        if (dist > this.attackRange * 1.25) { this.setState('chase'); break; }
        if (this.attackCooldown <= 0 && !this.animator.busy) {
          this.attackCooldown = this.attackInterval;
          this.animator.play('attackSwing', this.attackDuration, {
            events: [{ at: 0.45, name: 'impact' }],
            onEvent: (name) => {
              if (name !== 'impact') return;
              if (!player.alive) return;
              if (this.distanceTo(player) > this.attackRange * 1.3) return;
              const dir = new THREE.Vector3(
                player.position.x - this.position.x, 0, player.position.z - this.position.z
              ).normalize();
              player.damage(this.attackDamage, this, { direction: dir, stagger: 0.5 });
              player.applyKnockback(dir.x, dir.z, 1.6);
              world.bus?.emit('combat:hit', {
                attacker: this, victim: player, amount: this.attackDamage, direction: dir,
              });
            },
          });
          this.setState('reposition');
        }
        break;
      }

      case 'reposition': {
        // Strafe around the player while the swing recovers.
        if (this.stateTime > 0.55) { this.setState(dist <= this.attackRange * 1.2 ? 'attack' : 'chase'); break; }
        this.faceTowards(player.position.x, player.position.z);
        const ang = Math.atan2(
          this.position.x - player.position.x,
          this.position.z - player.position.z
        ) + this._circleDir * 0.9;
        const r = this.attackRange * 0.95;
        this.setPath([{
          x: player.position.x + Math.sin(ang) * r,
          z: player.position.z + Math.cos(ang) * r,
        }]);
        break;
      }
      default: break;
    }

    super.update(dt, world);
  }

  kill(source) {
    const wasAlive = this.alive;
    super.kill(source);
    if (wasAlive) this._deathAt = performance.now();
  }
}
