import * as THREE from 'three';

/**
 * Procedural animator.
 *
 * No clips. Every pose is a function of (phase, speed, state), so gait scales
 * continuously with movement speed, and one-shot actions (attack, hit, death)
 * are layered on top of locomotion rather than replacing it. That layering is
 * why a character can stagger mid-stride here instead of snapping to a
 * separate hit animation the way clip-based ARPGs of the era had to.
 */
export class Animator {
  constructor(rig, opts = {}) {
    this.rig = rig;
    this.phase = Math.random() * Math.PI * 2;
    this.speed = 0;             // world units/sec, set by the entity
    this.strideLength = opts.strideLength ?? 1.35;
    this.bounce = opts.bounce ?? 1.0;
    this.weight = opts.weight ?? 1.0;     // heavier = slower, lower arcs
    this.idleSway = opts.idleSway ?? 1.0;

    this.time = 0;
    this.facing = 0;

    /** @type {{name:string,t:number,dur:number,onEvent?:Function,fired:Set}|null} */
    this.action = null;
    this.actionBlend = 0;

    this.dead = false;
    this.deathTime = 0;

    this.hitFlash = 0;
    this.hitDir = new THREE.Vector3();
  }

  play(name, duration, opts = {}) {
    this.action = {
      name,
      t: 0,
      dur: duration,
      events: opts.events || [],
      fired: new Set(),
      onEvent: opts.onEvent,
      data: opts.data || {},
    };
    return this.action;
  }

  cancel() { this.action = null; }
  get busy() { return !!this.action; }

  hit(direction, strength = 1) {
    this.hitFlash = Math.min(1, this.hitFlash + strength);
    if (direction) this.hitDir.copy(direction).normalize();
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.deathTime = 0;
    this.action = null;
  }

  update(dt, { speed = 0, facing = 0 } = {}) {
    this.time += dt;
    this.speed = speed;
    this.facing = facing;

    const rig = this.rig;
    rig.resetPose();

    if (this.dead) {
      this.deathTime += dt;
      this._poseDeath(Math.min(1, this.deathTime / 0.9));
      return;
    }

    // --- locomotion base layer ---------------------------------------------
    const gait = THREE.MathUtils.clamp(speed / 4.2, 0, 1.6);
    // Stride frequency rises with the square root of speed, which is how real
    // gait works -- doubling speed does not double cadence, it lengthens the
    // stride too.
    const freq = (1.1 + Math.sqrt(gait) * 2.6) / Math.max(0.6, this.weight * 0.5 + 0.5);
    this.phase += dt * freq * Math.PI * 2;

    if (gait > 0.02) this._poseWalk(gait);
    else this._poseIdle();

    // --- action layer -------------------------------------------------------
    if (this.action) {
      const a = this.action;
      a.t += dt;
      const u = THREE.MathUtils.clamp(a.t / a.dur, 0, 1);

      for (const ev of a.events) {
        if (u >= ev.at && !a.fired.has(ev)) {
          a.fired.add(ev);
          a.onEvent?.(ev.name, a.data);
        }
      }

      // Ease actions in fast and out slow so impacts land crisply.
      const w = u < 0.15 ? u / 0.15 : 1 - Math.pow((u - 0.15) / 0.85, 2);
      switch (a.name) {
        case 'attackSwing': this._poseAttackSwing(u, w); break;
        case 'attackThrust': this._poseAttackThrust(u, w); break;
        case 'cast': this._poseCast(u, w); break;
        default: break;
      }

      if (u >= 1) this.action = null;
    }

    // --- hit reaction (additive, always on top) -----------------------------
    if (this.hitFlash > 0.001) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 3.2);
      const k = this.hitFlash * this.hitFlash;
      // Recoil away from the blow, in the character's local frame.
      const local = Math.atan2(this.hitDir.x, this.hitDir.z) - this.facing;
      rig.addRot('spine', Math.cos(local) * 0.45, 0, -Math.sin(local) * 0.35, k);
      rig.addRot('chest', Math.cos(local) * 0.30, 0, -Math.sin(local) * 0.25, k);
      rig.addRot('head', Math.cos(local) * 0.25, 0, -Math.sin(local) * 0.20, k);
      rig.offsetPos('root', -Math.sin(local) * 0.0, -0.05 * k, -Math.cos(local) * 0.0);
    }
  }

  _poseIdle() {
    const rig = this.rig;
    const t = this.time;
    const s = this.idleSway;
    // Breathing: a slow chest lift with a counter-rotation in the pelvis, plus
    // a barely-there weight shift so the character never looks frozen.
    const breath = Math.sin(t * 1.35) * 0.5 + 0.5;
    const shift = Math.sin(t * 0.42) * s;

    rig.offsetPos('root', 0, breath * 0.012 * s, 0);
    rig.setRot('pelvis', 0, shift * 0.05, shift * 0.03);
    rig.setRot('spine', -0.04 - breath * 0.02, -shift * 0.03, 0);
    rig.setRot('chest', -0.02 + breath * 0.035, -shift * 0.02, 0);
    rig.setRot('head', 0.03 - breath * 0.02, shift * 0.10, 0);

    // Arms hang with a slight outward flare from the lats.
    rig.setRot('upperArmL', 0.08 + breath * 0.02, 0, 0.14 + shift * 0.02);
    rig.setRot('upperArmR', 0.08 + breath * 0.02, 0, -0.14 - shift * 0.02);
    rig.setRot('lowerArmL', -0.22, 0, 0.06);
    rig.setRot('lowerArmR', -0.22, 0, -0.06);

    rig.setRot('thighL', -0.02, 0, 0.03);
    rig.setRot('thighR', -0.02, 0, -0.03);
    rig.setRot('shinL', 0.04, 0, 0);
    rig.setRot('shinR', 0.04, 0, 0);
  }

  _poseWalk(gait) {
    const rig = this.rig;
    const p = this.phase;
    const amp = Math.min(1, gait) * this.strideLength;
    const run = THREE.MathUtils.clamp((gait - 0.55) / 0.7, 0, 1);

    const sin = Math.sin(p);
    const cos = Math.cos(p);

    // Vertical bob peaks twice per stride (once per footfall).
    const bob = -Math.abs(cos) * 0.055 * amp * this.bounce;
    // Lateral sway once per stride, opposite the planted foot.
    const sway = sin * 0.022 * amp;
    rig.offsetPos('root', sway, bob + run * 0.03, 0);

    // Forward lean scales with speed: walking is upright, running pitches in.
    const lean = 0.06 + run * 0.30;
    rig.setRot('pelvis', lean * 0.3, -sin * 0.20 * amp, 0);
    rig.setRot('spine', lean * 0.4, sin * 0.10 * amp, -sway * 0.6);
    rig.setRot('chest', lean * 0.3, sin * 0.16 * amp, 0);
    rig.setRot('head', -lean * 0.5, -sin * 0.05 * amp, 0);

    // Legs: thigh swings as a sine, shin flexes only on the recovery half so
    // the leg stays straight when it is bearing weight.
    const legSwing = 0.62 * amp;
    const thighL = sin * legSwing;
    const thighR = -sin * legSwing;
    rig.setRot('thighL', thighL, 0, 0.03);
    rig.setRot('thighR', thighR, 0, -0.03);
    rig.setRot('shinL', Math.max(0, -sin) * 1.05 * amp + 0.05, 0, 0);
    rig.setRot('shinR', Math.max(0, sin) * 1.05 * amp + 0.05, 0, 0);
    rig.setRot('footL', -thighL * 0.45 + 0.08, 0, 0);
    rig.setRot('footR', -thighR * 0.45 + 0.08, 0, 0);

    // Arms counter-swing the legs.
    const armSwing = 0.55 * amp * (0.6 + run * 0.6);
    rig.setRot('upperArmL', -sin * armSwing + 0.05, 0, 0.12 + run * 0.10);
    rig.setRot('upperArmR', sin * armSwing + 0.05, 0, -0.12 - run * 0.10);
    rig.setRot('lowerArmL', -0.30 - run * 0.55 - Math.max(0, -sin) * 0.3, 0, 0);
    rig.setRot('lowerArmR', -0.30 - run * 0.55 - Math.max(0, sin) * 0.3, 0, 0);
  }

  _poseAttackSwing(u, w) {
    const rig = this.rig;
    // Anticipation (wind back) then a fast arc through, then follow-through.
    // The curve is deliberately asymmetric: 35% of the time is the wind-up,
    // 15% is the strike, 50% is recovery. Symmetric swings feel weightless.
    let swing;
    if (u < 0.35) swing = -Math.pow(u / 0.35, 0.7) * 1.0;
    else if (u < 0.5) swing = -1.0 + Math.pow((u - 0.35) / 0.15, 0.6) * 2.6;
    else swing = 1.6 - ((u - 0.5) / 0.5) * 1.6;

    const twist = swing * 0.55;
    rig.addRot('pelvis', 0, -twist * 0.5, 0, w);
    rig.addRot('spine', swing * 0.12, -twist * 0.7, 0, w);
    rig.addRot('chest', swing * 0.10, -twist * 0.9, 0, w);
    rig.addRot('head', 0, -twist * 0.3, 0, w);

    rig.addRot('upperArmR', -1.3 + swing * 1.55, -0.35 - twist * 0.4, -0.5 + swing * 0.5, w);
    rig.addRot('lowerArmR', -1.5 + Math.max(0, swing) * 1.2, 0, 0, w);
    rig.addRot('upperArmL', -0.35 + swing * 0.5, 0.4, 0.45, w);
    rig.addRot('lowerArmL', -0.9, 0, 0, w);

    // Step into the blow.
    rig.addRot('thighL', Math.max(0, swing) * 0.30, 0, 0, w);
    rig.addRot('thighR', -Math.max(0, swing) * 0.18, 0, 0, w);
  }

  _poseAttackThrust(u, w) {
    const rig = this.rig;
    let ext;
    if (u < 0.4) ext = -Math.pow(u / 0.4, 0.8) * 0.8;
    else if (u < 0.55) ext = -0.8 + Math.pow((u - 0.4) / 0.15, 0.5) * 2.3;
    else ext = 1.5 - ((u - 0.55) / 0.45) * 1.5;

    rig.addRot('pelvis', 0, -ext * 0.25, 0, w);
    rig.addRot('spine', ext * 0.10, -ext * 0.35, 0, w);
    rig.addRot('chest', ext * 0.06, -ext * 0.45, 0, w);
    rig.addRot('upperArmR', -1.45 - ext * 0.1, -0.15, -0.15, w);
    rig.addRot('lowerArmR', -1.6 + Math.max(0, ext) * 1.55, 0, 0, w);
    rig.addRot('thighL', Math.max(0, ext) * 0.45, 0, 0, w);
  }

  _poseCast(u, w) {
    const rig = this.rig;
    // Gather (arms in, spine curls), release (arms thrown forward and out).
    const gather = u < 0.55 ? Math.pow(u / 0.55, 0.8) : 1 - Math.pow((u - 0.55) / 0.45, 0.5);
    const release = u < 0.55 ? 0 : Math.pow((u - 0.55) / 0.45, 0.4);

    rig.addRot('spine', -gather * 0.28 + release * 0.20, 0, 0, w);
    rig.addRot('chest', -gather * 0.20 + release * 0.16, 0, 0, w);
    rig.addRot('head', -gather * 0.15 + release * 0.10, 0, 0, w);

    const armUp = -1.1 * gather - 0.9 * release;
    rig.addRot('upperArmR', armUp, -0.25 + release * 0.3, -0.45 + gather * 0.35, w);
    rig.addRot('upperArmL', armUp, 0.25 - release * 0.3, 0.45 - gather * 0.35, w);
    rig.addRot('lowerArmR', -1.35 + release * 1.05, 0, 0, w);
    rig.addRot('lowerArmL', -1.35 + release * 1.05, 0, 0, w);
  }

  _poseDeath(u) {
    const rig = this.rig;
    // Collapse: knees buckle first, then the torso folds, then the whole body
    // rotates onto its side. Ease-out so the last of it settles slowly.
    const e = 1 - Math.pow(1 - u, 3);
    const knee = Math.min(1, u / 0.4);
    const fold = THREE.MathUtils.clamp((u - 0.2) / 0.5, 0, 1);

    rig.offsetPos('root', 0, -this.rig.spec.height * 0.42 * e, -0.25 * e);
    rig.setRot('root', -1.35 * e, 0.35 * e, 0.25 * e);

    rig.setRot('pelvis', 0.6 * fold, 0, 0);
    rig.setRot('spine', 0.45 * fold, 0.15 * fold, 0.1 * fold);
    rig.setRot('chest', 0.35 * fold, 0.1 * fold, 0);
    rig.setRot('head', 0.5 * fold, -0.2 * fold, 0.15 * fold);

    rig.setRot('thighL', -1.5 * knee, 0, 0.25 * knee);
    rig.setRot('thighR', -1.2 * knee, 0, -0.2 * knee);
    rig.setRot('shinL', 1.9 * knee, 0, 0);
    rig.setRot('shinR', 1.6 * knee, 0, 0);

    rig.setRot('upperArmL', 0.9 * e, 0.3 * e, 0.8 * e);
    rig.setRot('upperArmR', 0.7 * e, -0.3 * e, -0.9 * e);
    rig.setRot('lowerArmL', -0.5 * e, 0, 0);
    rig.setRot('lowerArmR', -0.4 * e, 0, 0);
  }
}
