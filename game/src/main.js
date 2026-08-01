import * as THREE from 'three';

import { EventBus } from './core/EventBus.js';
import { RNG } from './core/RNG.js';
import { Input } from './core/Input.js';

import { createRenderer, applyQuality, handleResize } from './render/Renderer.js';
import { CameraRig } from './render/CameraRig.js';
import { PostFX } from './render/PostFX.js';
import { Lighting } from './render/Lighting.js';
import { MaterialLibrary } from './render/Materials.js';

import { TILE } from './world/LevelBuilder.js';
import { createZone, applyZoneLook, DEFAULT_ZONE } from './world/zones/index.js';

import { Player } from './entities/Player.js';
import { Monster } from './entities/Monster.js';
import { resolveOverlaps } from './entities/Entity.js';

import { HUD } from './ui/HUD.js';

import { createFX } from './fx/index.js';
import { createAudio } from './audio/index.js';
import { createItems } from './items/index.js';
import { createSkills } from './skills/index.js';

/**
 * Game bootstrap and main loop.
 *
 * `world` is the single object every subsystem receives. Adding a subsystem
 * means hanging it here and calling it from the fixed list of update phases
 * below -- the ordering of those phases is load-bearing (input before AI,
 * AI before physics, physics before camera, camera before render).
 */
class Game {
  constructor() {
    this.canvas = document.getElementById('viewport');
    this.uiRoot = document.getElementById('ui-root');
    this.boot = document.getElementById('boot');

    // A URL seed makes screenshots reproducible across critic iterations.
    const params = new URLSearchParams(location.search);
    this.seed = Number(params.get('seed') ?? 20250731) >>> 0;
    this.qualityName = params.get('quality') ?? 'high';
    this.paused = params.get('paused') === '1';
    this.zoneName = params.get('zone') ?? DEFAULT_ZONE;

    this.rng = new RNG(this.seed);
    this.bus = new EventBus();

    this.scene = new THREE.Scene();
    this.scene.name = 'World';

    this.renderer = createRenderer(this.canvas);
    this.quality = applyQuality(this.renderer, this.qualityName);

    this.rig = new CameraRig({ elevation: 34, azimuth: 45, distance: 34 });
    this.camera = this.rig.camera;

    this.input = new Input(this.canvas);
    this.clock = new THREE.Clock();

    this.entities = [];
    this.monsters = [];

    /** Shared context handed to every entity update. */
    this.world = {
      scene: this.scene,
      bus: this.bus,
      rng: this.rng,
      camera: this.camera,
      colliders: null,
      nav: null,
      player: null,
      entities: this.entities,
      monsters: this.monsters,
      time: 0,
    };

    this.ready = false;
    this.frame = 0;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this.fps = 0;
  }

  async init() {
    this._status('quarrying stone', 0.1);
    const materials = await new MaterialLibrary({ size: 512 }).build();
    this.materials = materials;

    // Lighting exists before the zone so a zone can register its own emitters
    // and hand back a rig override during construction.
    this.lighting = new Lighting(this.scene, {
      shadowSize: this.quality.shadowSize,
      shadowBudget: 3,
    });

    this._status(`entering the ${this.zoneName}`, 0.45);
    this.zone = await createZone(this.zoneName, {
      scene: this.scene,
      rng: this.rng.fork(`zone:${this.zoneName}`),
      materials,
      lighting: this.lighting,
      quality: this.quality,
    });

    this.world.colliders = this.zone.colliders;
    this.world.nav = this.zone.nav;
    this.world.zone = this.zone;
    this.dungeon = this.zone.dungeon || null;
    this.level = this.zone.level || null;
    this.torchCount = this.zone.torchCount || 0;

    this._status('waking the dead', 0.85);
    this._spawnActors();

    // Hero light. Every ARPG in this lineage cheats one: a soft warm point
    // light riding the player so the character stays readable in unlit
    // stretches. Without it the hero vanishes between torches, which reads as
    // a bug rather than as atmosphere.
    this.heroLight = new THREE.PointLight(0xffd2a0, 14, 11, 2.0);
    this.heroLight.position.set(0, 2.2, 0);
    this.scene.add(this.heroLight);

    this._status('binding the sigils', 0.94);
    this.postfx = new PostFX(this.renderer, this.scene, this.camera, this.quality);
    this.hud = new HUD(this.uiRoot);

    // The zone owns its own look: colour grade, fog, and light rig bias.
    applyZoneLook(this.zone, this.postfx, this.lighting);

    // Subsystems. Each owns a directory, is constructed once with the shared
    // context, and is ticked from exactly one phase of the loop below.
    this.fx = createFX(this._ctx());
    this.audio = createAudio(this._ctx());
    this.items = createItems(this._ctx());
    this.skills = createSkills(this._ctx());
    this.subsystems = [this.fx, this.audio, this.items, this.skills, this.zone];

    addEventListener('resize', () => {
      handleResize(this.renderer, this.camera, null);
      const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.postfx.setSize(s.x, s.y);
    });

    // Warm the shader cache before the first visible frame, otherwise the
    // opening second is a slideshow while WebGL compiles every program.
    this.renderer.compile(this.scene, this.camera);

    this._status('ready', 1.0);
    this.ready = true;
    setTimeout(() => this.boot.classList.add('hidden'), 260);

    // Test hook for the headless screenshot harness.
    window.__game = this;
    window.__ready = true;
  }

  /** Context handed to every subsystem factory. */
  _ctx() {
    return {
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      bus: this.bus,
      rng: this.rng,
      world: this.world,
      dungeon: this.dungeon,
      level: this.level,
      lighting: this.lighting,
      materials: this.materials,
      uiRoot: this.uiRoot,
      input: this.input,
      get player() { return this.world.player; },
    };
  }

  _status(text, progress) {
    const s = this.boot?.querySelector('.boot-status');
    const bar = this.boot?.querySelector('.boot-bar > i');
    if (s) s.textContent = text;
    if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
  }

  _spawnActors() {
    const rng = this.rng.fork('actors');
    const zone = this.zone;

    const player = new Player();
    player.position.copy(zone.spawnPoint);
    this.scene.add(player.object);
    this.entities.push(player);
    this.player = player;
    this.world.player = player;
    this.rig.snapTo(player.position);

    // The zone decides where and what spawns; the loop only instantiates.
    for (const spawn of zone.spawns || []) {
      const m = new Monster({
        kind: spawn.kind,
        maxHealth: spawn.maxHealth ?? (spawn.kind === 'brute' ? 90 : 46),
        height: spawn.height ?? rng.range(1.6, 1.86),
      });
      m.health = m.maxHealth;
      m.position.copy(spawn.position);
      m.spawnPoint.copy(m.position);
      m.facing = m.targetFacing = rng.range(-Math.PI, Math.PI);
      this.scene.add(m.object);
      this.entities.push(m);
      this.monsters.push(m);
    }
  }

  // -------------------------------------------------------------- main loop

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      this.tick();
    };
    loop();
  }

  tick() {
    if (!this.ready) return;
    // Clamp dt: a background tab returns a multi-second delta that would
    // teleport every actor through walls.
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    this.frame++;
    this.world.time += dt;

    if (!this.paused) {
      this._updateInput(dt);
      this._updateEntities(dt);
    }

    // fx phase: after the world has settled, before the camera reads it.
    for (const s of this.subsystems) s?.update?.(dt);

    this.heroLight.position.set(this.player.position.x, 2.2, this.player.position.z);

    this.rig.setTarget(this.player.position);
    this.rig.update(dt, this.input.groundValid ? this.input.ground : null);
    this.lighting.update(dt, this.player.position);
    this.postfx.update(dt);

    this.hud.update(this.player);
    this._updateDebug(dt);

    this.renderer.info.reset();
    this.postfx.render(dt);
    this.input.endFrame();
  }

  _updateInput(dt) {
    const input = this.input;
    input.updateGround(this.camera, 0);

    if (input.wheel !== 0) this.rig.zoom(input.wheel);
    if (input.pressed('F3')) this.hud.toggleDebug();

    if (!input.pointerOverUI && input.mouseDown('left') && this.player.alive) {
      const hit = this._pickEntity();
      if (hit && hit.faction === 'hostile' && hit.alive) {
        this.player.orderAttack(hit, this.world.nav);
      } else if (input.groundValid) {
        this.player.orderMove(input.ground.x, input.ground.z, this.world.nav);
      }
    }

    // Auto-swing when a target is in reach.
    const t = this.player.target;
    if (t && t.alive && this.player.distanceTo(t) <= this.player.attackRange && this.player.canAttack()) {
      this.player.attack((ev) => {
        if (ev !== 'impact') return;
        if (!t.alive || this.player.distanceTo(t) > this.player.attackRange * 1.35) return;
        const dir = new THREE.Vector3(
          t.position.x - this.player.position.x, 0, t.position.z - this.player.position.z
        ).normalize();
        const dmg = 18 + this.rng.range(-4, 6);
        t.damage(dmg, this.player, { direction: dir, stagger: 0.7 });
        t.applyKnockback(dir.x, dir.z, 2.2);
        this.rig.addTrauma(0.16);
        this.bus.emit('combat:hit', { attacker: this.player, victim: t, amount: dmg, direction: dir });
        if (!t.alive) {
          this.player.experience += t.experienceValue;
          this.bus.emit('entity:died', { entity: t });
        }
      });
    }
  }

  _pickEntity() {
    const ray = this.input.raycaster(this.camera);
    let best = null, bestDist = Infinity;
    for (const e of this.entities) {
      if (e === this.player || !e.alive) continue;
      // Capsule-ish proxy test: cheaper and far more forgiving than raycasting
      // the actual limb meshes, which at this camera makes targeting fiddly.
      const center = _v1.copy(e.position).setY(e.height * 0.5);
      const d = ray.ray.distanceSqToPoint(center);
      if (d > (e.radius * 1.9) ** 2) continue;
      const along = ray.ray.origin.distanceToSquared(center);
      if (along < bestDist) { bestDist = along; best = e; }
    }
    return best;
  }

  _updateEntities(dt) {
    for (const e of this.entities) e.update(dt, this.world);
    resolveOverlaps(this.entities, 2);

    // Reap corpses after they have had time to settle and fade.
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (e.alive || e === this.player) continue;
      if (e.deathTimer > 14) {
        e.dispose();
        this.entities.splice(i, 1);
        const j = this.monsters.indexOf(e);
        if (j >= 0) this.monsters.splice(j, 1);
      }
    }
  }

  _updateDebug(dt) {
    this._fpsAccum += dt;
    this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }
    const info = this.renderer.info;
    this.hud.setDebug(
      `fps      ${this.fps.toFixed(1)}\n` +
      `seed     ${this.seed}\n` +
      `draws    ${info.render.calls}\n` +
      `tris     ${info.render.triangles.toLocaleString()}\n` +
      `entities ${this.entities.length}\n` +
      `torches  ${this.torchCount}\n` +
      `zone     ${this.zoneName}\n` +
      `pos      ${this.player.position.x.toFixed(1)}, ${this.player.position.z.toFixed(1)}`
    );
  }
}

const _v1 = new THREE.Vector3();

const game = new Game();
window.__gameInstance = game;
game.init().then(() => game.start()).catch((err) => {
  console.error(err);
  const s = document.querySelector('.boot-status');
  if (s) { s.textContent = 'failed: ' + err.message; s.style.color = '#c33'; }
  window.__bootError = String(err && err.stack || err);
});
