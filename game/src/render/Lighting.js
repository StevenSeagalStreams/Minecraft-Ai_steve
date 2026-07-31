import * as THREE from 'three';

/**
 * Lighting model for the dungeon.
 *
 * The look rests on one idea: almost all light in the frame is *sourced*. A
 * very dim blue-grey ambient establishes shape in unlit corners, and every
 * bright thing in the scene is a physical emitter with visible falloff. That
 * contrast -- warm pools eating into cold dark -- is the entire Diablo mood.
 *
 * Shadow-casting point lights are expensive (6 faces each), so we keep a small
 * budget and assign it dynamically to the emitters nearest the camera target.
 */
export class Lighting {
  constructor(scene, quality = {}) {
    this.scene = scene;
    this.shadowSize = quality.shadowSize ?? 2048;
    this.shadowBudget = quality.shadowBudget ?? 3;

    // Cold, very dim fill. Ambient is deliberately blue: unlit stone should
    // read as moonlit/mineral, never as flat grey.
    this.hemi = new THREE.HemisphereLight(0x2a3a56, 0x0a0a10, 0.55);
    scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0x141c2c, 0.45);
    scene.add(this.ambient);

    // A weak key from above-behind. Not a sun -- it exists to keep silhouettes
    // legible when the player walks through an unlit stretch.
    this.key = new THREE.DirectionalLight(0x8095c0, 0.85);
    this.key.position.set(-24, 40, -18);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(this.shadowSize, this.shadowSize);
    this.key.shadow.camera.near = 5;
    this.key.shadow.camera.far = 110;
    const s = 34;
    Object.assign(this.key.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
    this.key.shadow.bias = -0.0009;
    this.key.shadow.normalBias = 0.035;
    this.key.shadow.radius = 2.5;
    this.key.shadow.camera.updateProjectionMatrix();
    scene.add(this.key);
    scene.add(this.key.target);

    // Exponential fog kills the horizon and makes corridors recede into black.
    scene.fog = new THREE.FogExp2(0x05070c, 0.0135);
    this.fogBase = 0.0135;

    /** @type {TorchLight[]} */
    this.torches = [];
    this._shadowPool = [];
    for (let i = 0; i < this.shadowBudget; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 1);
      l.castShadow = true;
      l.shadow.mapSize.set(1024, 1024);
      l.shadow.camera.near = 0.15;
      l.shadow.camera.far = 22;
      l.shadow.bias = -0.004;
      l.shadow.normalBias = 0.05;
      l.visible = false;
      scene.add(l);
      this._shadowPool.push({ light: l, owner: null });
    }

    this._time = 0;
  }

  /**
   * Register an emitter. `kind` selects a flicker profile.
   * @returns {TorchLight}
   */
  addTorch(position, opts = {}) {
    const t = new TorchLight(position, opts);
    this.scene.add(t.light);
    this.torches.push(t);
    return t;
  }

  removeTorch(t) {
    const i = this.torches.indexOf(t);
    if (i >= 0) this.torches.splice(i, 1);
    this.scene.remove(t.light);
    for (const slot of this._shadowPool) {
      if (slot.owner === t) { slot.owner = null; slot.light.visible = false; }
    }
  }

  setFogDensity(d) {
    if (this.scene.fog) this.scene.fog.density = d;
  }

  update(dt, focus) {
    this._time += dt;
    for (const t of this.torches) t.update(dt, this._time);

    if (!focus || this._shadowPool.length === 0) return;

    // Reassign the shadow budget to the nearest active emitters. Sorting the
    // whole list each frame is fine at dungeon scale and avoids the popping
    // you get from a hysteresis-free nearest-N over a moving camera.
    const candidates = this.torches
      .filter((t) => t.castsShadow && t.light.visible && t.intensity > 0.01)
      .map((t) => ({ t, d: t.light.position.distanceToSquared(focus) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this._shadowPool.length);

    const chosen = new Set(candidates.map((c) => c.t));
    for (const slot of this._shadowPool) {
      if (slot.owner && !chosen.has(slot.owner)) {
        slot.owner.usingShadowSlot = false;
        slot.owner = null;
        slot.light.visible = false;
      }
    }
    for (const c of candidates) {
      if (c.t.usingShadowSlot) continue;
      const free = this._shadowPool.find((s) => !s.owner);
      if (!free) break;
      free.owner = c.t;
      c.t.usingShadowSlot = true;
    }
    for (const slot of this._shadowPool) {
      if (!slot.owner) continue;
      const t = slot.owner;
      slot.light.visible = true;
      slot.light.position.copy(t.light.position);
      slot.light.color.copy(t.light.color);
      slot.light.intensity = t.light.intensity;
      slot.light.distance = t.light.distance;
      slot.light.decay = t.light.decay;
      // The proxy carries the shadow; the original stops contributing light so
      // the surface is not lit twice.
      t.light.intensity = 0;
    }
  }
}

const FLICKER = {
  // amplitude, speed, jitter (positional), warmth swing
  torch:   { amp: 0.22, speed: 7.5, jitter: 0.045, warmth: 0.06 },
  brazier: { amp: 0.16, speed: 5.0, jitter: 0.030, warmth: 0.05 },
  candle:  { amp: 0.32, speed: 11.0, jitter: 0.060, warmth: 0.08 },
  magic:   { amp: 0.14, speed: 2.2, jitter: 0.010, warmth: 0.00 },
  ember:   { amp: 0.09, speed: 1.4, jitter: 0.005, warmth: 0.03 },
  steady:  { amp: 0.00, speed: 0.0, jitter: 0.000, warmth: 0.00 },
};

export class TorchLight {
  constructor(position, opts = {}) {
    this.kind = opts.kind ?? 'torch';
    this.profile = FLICKER[this.kind] ?? FLICKER.torch;

    this.baseColor = new THREE.Color(opts.color ?? 0xff9d4a);
    this.intensity = opts.intensity ?? 9.0;
    this.distance = opts.distance ?? 13;
    this.castsShadow = opts.castShadow ?? false;
    this.usingShadowSlot = false;

    this.light = new THREE.PointLight(this.baseColor.clone(), this.intensity, this.distance, 2.0);
    this.light.position.copy(position);
    this.basePosition = position.clone();

    // Per-instance phase so a row of torches never pulses in unison.
    this._phase = Math.random() * 1000;
    this._noiseState = Math.random();
  }

  /** Smooth-ish value noise driven by summed sines; cheap and non-periodic enough. */
  _flicker(t) {
    const p = this.profile;
    const x = t * p.speed + this._phase;
    return (
      Math.sin(x) * 0.5 +
      Math.sin(x * 2.31 + 1.7) * 0.28 +
      Math.sin(x * 4.77 + 3.1) * 0.14 +
      Math.sin(x * 9.13 + 5.5) * 0.08
    );
  }

  update(dt, time) {
    const p = this.profile;
    if (p.amp === 0) {
      this.light.intensity = this.intensity;
      return;
    }
    const f = this._flicker(time);
    this.light.intensity = Math.max(0, this.intensity * (1 + f * p.amp));

    if (p.jitter > 0) {
      this.light.position.set(
        this.basePosition.x + f * p.jitter,
        this.basePosition.y + Math.sin(time * p.speed * 1.7 + this._phase) * p.jitter * 0.6,
        this.basePosition.z + Math.sin(time * p.speed * 0.9 + this._phase * 2) * p.jitter
      );
    }

    if (p.warmth > 0) {
      // Real flame gets whiter as it flares and redder as it gutters.
      const w = f * p.warmth;
      this.light.color.setRGB(
        Math.min(1, this.baseColor.r + w * 0.2),
        Math.max(0, this.baseColor.g + w * 0.5),
        Math.max(0, this.baseColor.b + w * 0.9)
      );
    }
  }
}
