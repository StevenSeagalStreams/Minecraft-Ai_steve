import * as THREE from 'three';
import { CharacterRig } from './CharacterRig.js';

/**
 * Character construction.
 *
 * Bodies are assembled from tapered capsules and beveled plates rather than
 * boxes. The taper is the whole trick: a limb that is wider at the joint and
 * narrower at the extremity reads as anatomy, while a constant-radius capsule
 * reads as a balloon animal no matter how good the material is.
 */

/** A capsule whose radius varies along its length. */
export function taperedLimb(rTop, rBottom, length, segments = 12, rings = 6) {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, length, segments, rings, false);
  // Round the caps by pushing the end rings inward and down.
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = (v.y + length / 2) / length; // 0 bottom .. 1 top
    if (t > 0.94 || t < 0.06) {
      const edge = t > 0.5 ? (t - 0.94) / 0.06 : (0.06 - t) / 0.06;
      const shrink = Math.cos(edge * Math.PI * 0.5);
      v.x *= shrink;
      v.z *= shrink;
      v.y += (t > 0.5 ? 1 : -1) * (1 - shrink) * (t > 0.5 ? rTop : rBottom) * 0.85;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  geo.translate(0, -length / 2, 0); // hang from the joint
  return geo;
}

/** A slightly squashed sphere -- torso masses, skulls, pauldrons. */
export function mass(rx, ry, rz, segments = 16) {
  const geo = new THREE.SphereGeometry(1, segments, Math.max(8, segments / 2));
  geo.scale(rx, ry, rz);
  return geo;
}

/** Beveled plate for armour: a box with chamfered edges catches rim light. */
export function plate(w, h, d, bevel = 0.02) {
  const geo = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ax = Math.abs(v.x) > w / 2 - 1e-4;
    const ay = Math.abs(v.y) > h / 2 - 1e-4;
    const az = Math.abs(v.z) > d / 2 - 1e-4;
    const edges = (ax ? 1 : 0) + (ay ? 1 : 0) + (az ? 1 : 0);
    if (edges >= 2) {
      if (ax) v.x -= Math.sign(v.x) * bevel;
      if (ay) v.y -= Math.sign(v.y) * bevel;
      if (az) v.z -= Math.sign(v.z) * bevel;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------

export function characterMaterials(palette = {}) {
  const p = {
    skin: 0x9a7660,
    cloth: 0x3a2f2a,
    leather: 0x4a3527,
    metal: 0x8b8d92,
    metalDark: 0x4a4d55,
    accent: 0x8c2f24,
    bone: 0xcfc6ad,
    ...palette,
  };

  return {
    skin: new THREE.MeshStandardMaterial({ color: p.skin, roughness: 0.72, metalness: 0.0 }),
    cloth: new THREE.MeshStandardMaterial({ color: p.cloth, roughness: 0.95, metalness: 0.0 }),
    leather: new THREE.MeshStandardMaterial({ color: p.leather, roughness: 0.62, metalness: 0.02 }),
    metal: new THREE.MeshStandardMaterial({ color: p.metal, roughness: 0.34, metalness: 0.95, envMapIntensity: 1.1 }),
    metalDark: new THREE.MeshStandardMaterial({ color: p.metalDark, roughness: 0.48, metalness: 0.9, envMapIntensity: 0.9 }),
    accent: new THREE.MeshStandardMaterial({ color: p.accent, roughness: 0.8, metalness: 0.0 }),
    bone: new THREE.MeshStandardMaterial({ color: p.bone, roughness: 0.68, metalness: 0.0 }),
  };
}

// ---------------------------------------------------------------------------
// archetypes
// ---------------------------------------------------------------------------

/** Armoured melee hero. */
export function buildWarrior(opts = {}) {
  const rig = new CharacterRig({ height: opts.height ?? 1.9, build: opts.build ?? 1.18 });
  const M = characterMaterials(opts.palette);
  const L = rig.lengths;
  const s = rig.spec;

  // torso
  rig.attach('pelvis', mass(s.height * 0.088 * s.build, s.height * 0.055, s.height * 0.070), M.leather,
    { pivot: [0, s.height * 0.02, 0] });
  rig.attach('spine', mass(s.height * 0.098 * s.build, s.height * 0.075, s.height * 0.072), M.metalDark,
    { pivot: [0, s.height * 0.04, 0] });
  rig.attach('chest', mass(s.height * 0.108 * s.build, s.height * 0.080, s.height * 0.076), M.metal,
    { pivot: [0, s.height * 0.03, 0] });
  // breastplate ridge
  rig.attach('chest', plate(s.height * 0.10, s.height * 0.11, s.height * 0.02, 0.012), M.metal,
    { pivot: [0, s.height * 0.035, s.height * 0.062] });

  // head
  rig.attach('head', mass(s.height * 0.052, s.height * 0.062, s.height * 0.056), M.skin,
    { pivot: [0, s.height * 0.025, 0] });
  // helm
  rig.attach('head', mass(s.height * 0.058, s.height * 0.050, s.height * 0.062, 18), M.metal,
    { pivot: [0, s.height * 0.042, -s.height * 0.004] });
  rig.attach('head', plate(s.height * 0.014, s.height * 0.055, s.height * 0.10, 0.006), M.metal,
    { pivot: [0, s.height * 0.065, 0] });

  for (const side of [-1, 1]) {
    const S = side < 0 ? 'L' : 'R';
    // pauldron
    rig.attach(`shoulder${S}`, mass(s.height * 0.050, s.height * 0.040, s.height * 0.050, 16), M.metal,
      { pivot: [side * s.height * 0.012, s.height * 0.010, 0] });
    rig.attach(`upperArm${S}`, taperedLimb(s.height * 0.034, s.height * 0.028, L.upperArm), M.metalDark);
    rig.attach(`lowerArm${S}`, taperedLimb(s.height * 0.028, s.height * 0.022, L.lowerArm), M.leather);
    // vambrace
    rig.attach(`lowerArm${S}`, taperedLimb(s.height * 0.030, s.height * 0.026, L.lowerArm * 0.45), M.metal,
      { pivot: [0, -L.lowerArm * 0.5, 0] });
    rig.attach(`hand${S}`, mass(s.height * 0.026, s.height * 0.030, s.height * 0.022), M.leather,
      { pivot: [0, -s.height * 0.020, 0] });

    // legs
    rig.attach(`thigh${S}`, taperedLimb(s.height * 0.048, s.height * 0.036, L.thigh), M.cloth);
    rig.attach(`shin${S}`, taperedLimb(s.height * 0.036, s.height * 0.026, L.shin), M.leather);
    rig.attach(`shin${S}`, taperedLimb(s.height * 0.038, s.height * 0.030, L.shin * 0.6), M.metal,
      { pivot: [0, -L.shin * 0.05, s.height * 0.004] });
    rig.attach(`foot${S}`, plate(s.height * 0.042, s.height * 0.022, L.foot * 1.5, 0.008), M.metalDark,
      { pivot: [0, -s.height * 0.008, L.foot * 0.3] });
  }

  return { rig, materials: M };
}

/** Undead skeleton -- the archetypal early-dungeon enemy. */
export function buildSkeleton(opts = {}) {
  const rig = new CharacterRig({ height: opts.height ?? 1.72, build: opts.build ?? 0.78 });
  const M = characterMaterials({ bone: opts.boneColor ?? 0xc9c0a6, ...opts.palette });
  const L = rig.lengths;
  const s = rig.spec;

  // ribcage as stacked arcs -- reads as bone from any angle and costs little
  rig.attach('pelvis', mass(s.height * 0.062, s.height * 0.040, s.height * 0.050), M.bone,
    { pivot: [0, s.height * 0.012, 0] });
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const rx = s.height * (0.070 - t * 0.018);
    rig.attach('spine', new THREE.TorusGeometry(rx, s.height * 0.006, 6, 14, Math.PI * 1.25), M.bone,
      { pivot: [0, s.height * (0.020 + t * 0.075), 0], rotation: [Math.PI / 2, 0, Math.PI * 0.375] });
  }
  rig.attach('spine', taperedLimb(s.height * 0.014, s.height * 0.016, L.spine + L.chest), M.bone,
    { pivot: [0, L.spine + L.chest, -s.height * 0.012] });

  // skull
  rig.attach('head', mass(s.height * 0.048, s.height * 0.052, s.height * 0.052, 16), M.bone,
    { pivot: [0, s.height * 0.028, 0] });
  rig.attach('head', mass(s.height * 0.030, s.height * 0.020, s.height * 0.022, 12), M.bone,
    { pivot: [0, s.height * 0.008, s.height * 0.036] });
  // eye sockets: tiny black spheres set deep, so torchlight leaves them dark
  const socket = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 });
  for (const side of [-1, 1]) {
    rig.attach('head', mass(s.height * 0.011, s.height * 0.012, s.height * 0.008, 10), socket,
      { pivot: [side * s.height * 0.019, s.height * 0.030, s.height * 0.040] });
  }

  for (const side of [-1, 1]) {
    const S = side < 0 ? 'L' : 'R';
    rig.attach(`shoulder${S}`, mass(s.height * 0.022, s.height * 0.016, s.height * 0.020, 10), M.bone);
    rig.attach(`upperArm${S}`, taperedLimb(s.height * 0.017, s.height * 0.013, L.upperArm, 8), M.bone);
    rig.attach(`lowerArm${S}`, taperedLimb(s.height * 0.014, s.height * 0.011, L.lowerArm, 8), M.bone);
    rig.attach(`hand${S}`, mass(s.height * 0.016, s.height * 0.020, s.height * 0.012, 10), M.bone,
      { pivot: [0, -s.height * 0.016, 0] });
    rig.attach(`thigh${S}`, taperedLimb(s.height * 0.022, s.height * 0.016, L.thigh, 8), M.bone);
    rig.attach(`shin${S}`, taperedLimb(s.height * 0.017, s.height * 0.012, L.shin, 8), M.bone);
    rig.attach(`foot${S}`, mass(s.height * 0.018, s.height * 0.010, L.foot * 0.9, 10), M.bone,
      { pivot: [0, -s.height * 0.006, L.foot * 0.25] });
  }

  // scraps of rotted cloth
  const rag = new THREE.MeshStandardMaterial({
    color: 0x2e2b23, roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.92,
  });
  rig.attach('pelvis', new THREE.PlaneGeometry(s.height * 0.16, s.height * 0.22, 3, 3), rag,
    { pivot: [0, -s.height * 0.08, s.height * 0.04] });

  return { rig, materials: M };
}

/** Simple sword: blade, fuller, guard, grip, pommel. */
export function buildSword(opts = {}) {
  const g = new THREE.Group();
  const len = opts.length ?? 0.95;
  const M = opts.materials ?? characterMaterials();

  const blade = new THREE.BoxGeometry(0.075, len, 0.018, 1, 6, 1);
  // taper the blade to a point and put a slight diamond cross-section on it
  const pos = blade.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = (v.y + len / 2) / len;
    const taper = t > 0.82 ? 1 - (t - 0.82) / 0.18 : 1 - t * 0.18;
    v.x *= Math.max(0.05, taper);
    v.z *= Math.max(0.25, taper);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  blade.computeVertexNormals();
  blade.translate(0, len / 2, 0);
  const bladeMesh = new THREE.Mesh(blade, M.metal);
  bladeMesh.castShadow = true;
  g.add(bladeMesh);

  const guard = new THREE.Mesh(plate(0.30, 0.035, 0.05, 0.01), M.metalDark);
  guard.castShadow = true;
  g.add(guard);

  const grip = new THREE.Mesh(taperedLimb(0.022, 0.026, 0.20, 8), M.leather);
  grip.position.y = 0;
  g.add(grip);

  const pommel = new THREE.Mesh(mass(0.035, 0.035, 0.030, 10), M.metalDark);
  pommel.position.y = -0.21;
  g.add(pommel);

  return g;
}
