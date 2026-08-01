import * as THREE from 'three';
import { box, cylinder, sphere, merge } from './GeoKit.js';

/**
 * Blighted-forest foliage: parametric trees (silhouette-mass first,
 * individual tree second -- the WoW pillar) plus the undergrowth that keeps
 * the ground from reading as empty between them. Everything here ends up as
 * a small, fixed number of InstancedMesh draw calls no matter how many
 * thousand instances are scattered.
 */

// ---------------------------------------------------------------------------
// tree geometry
// ---------------------------------------------------------------------------

const _up = new THREE.Vector3(0, 1, 0);
const _one = new THREE.Vector3(1, 1, 1);

/**
 * A tapered cylinder spanning two explicit points, built by aligning a
 * default Y-axis CylinderGeometry with a quaternion rather than composing
 * Euler rotY/rotZ guesses -- exact for an arbitrary direction, and it means
 * the "tip" used to chain sub-branches/canopy is the same point the mesh
 * actually ends at.
 */
function orientedSegment(rt, rb, from, to, radial = 6) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  if (len < 1e-5) return null;
  const g = new THREE.CylinderGeometry(rt, rb, len, radial);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(_up, dir.multiplyScalar(1 / len));
  g.applyMatrix4(new THREE.Matrix4().compose(from, q, _one));
  return g;
}

function sphericalDir(yaw, rise) {
  return new THREE.Vector3(Math.sin(yaw) * Math.cos(rise), Math.sin(rise), Math.cos(yaw) * Math.cos(rise));
}

/** Root flare + tapered multi-segment trunk, shared by every tree variant. */
function buildTrunkCore(rng, { height, baseR, segs = 3, bend = 0.35 }) {
  const parts = [];
  const flareH = height * 0.10;
  parts.push(cylinder(baseR * 1.05, baseR * 2.15, flareH, 8, 0, flareH / 2, 0));

  let cur = new THREE.Vector3(0, flareH, 0);
  let r = baseR * 1.05;
  const segH = (height - flareH) / segs;
  for (let i = 0; i < segs; i++) {
    const rNext = baseR * (1 - (i + 1) / (segs + 0.4)) * 0.95 + baseR * 0.12;
    const next = new THREE.Vector3(
      cur.x + rng.range(-1, 1) * bend * segH * 0.6,
      cur.y + segH,
      cur.z + rng.range(-1, 1) * bend * segH * 0.6
    );
    const seg = orientedSegment(rNext, r, cur, next, 7);
    if (seg) parts.push(seg);
    cur = next;
    r = rNext;
  }
  return { parts, topY: cur.y, topR: r, topPos: cur };
}

/** A single tapered branch with 0-1 sub-branch, returns tip positions for
 * canopy attachment. */
function buildBranch(rng, parts, origin, dirAngleY, riseAngle, len, r0) {
  const dir = sphericalDir(dirAngleY, riseAngle);
  const tip = origin.clone().addScaledVector(dir, len);
  const seg = orientedSegment(r0 * 0.32, r0, origin, tip, 5);
  if (seg) parts.push(seg);

  if (rng.bool(0.55)) {
    const subLen = len * rng.range(0.4, 0.6);
    const subYaw = dirAngleY + rng.range(-0.9, 0.9);
    const subRise = riseAngle + rng.range(0.1, 0.5);
    const subDir = sphericalDir(subYaw, subRise);
    const subTip = tip.clone().addScaledVector(subDir, subLen);
    const sub = orientedSegment(r0 * 0.12, r0 * 0.38, tip, subTip, 4);
    if (sub) parts.push(sub);
    return [tip, subTip];
  }
  return [tip];
}

/** A low-poly, chunky "clump" of dead/curled foliage -- faceted, not smooth,
 * so it reads as a silhouette mass rather than noisy detail. */
function buildCanopyClump(rng, cx, cy, cz, scale) {
  const parts = [];
  const n = 2 + rng.int(0, 2);
  for (let i = 0; i < n; i++) {
    const ox = rng.range(-0.35, 0.35) * scale;
    const oy = rng.range(-0.2, 0.25) * scale;
    const oz = rng.range(-0.35, 0.35) * scale;
    const r = scale * rng.range(0.45, 0.75);
    parts.push(sphere(r, 5, 4, cx + ox, cy + oy, cz + oz, 0.72));
  }
  return parts;
}

/** Full blighted tree: root flare, bent trunk, sparse branch hierarchy, a few
 * curled canopy clumps at some (not all) branch tips -- diseased sparseness
 * over a healthy full crown. */
export function buildFullTreeGeometry(rng) {
  const height = rng.range(6.5, 10.5);
  const baseR = rng.range(0.26, 0.4);
  const core = buildTrunkCore(rng, { height: height * 0.62, baseR, segs: 3, bend: 0.5 });
  const parts = [...core.parts];

  const branchCount = 4 + rng.int(0, 3);
  const canopyParts = [];
  let originY = core.topY * 0.55;
  for (let i = 0; i < branchCount; i++) {
    const t = i / (branchCount - 1 + 0.001);
    const oy = THREE.MathUtils.lerp(originY, core.topY * 0.98, t);
    const origin = new THREE.Vector3(core.topPos.x * (oy / core.topY), oy, core.topPos.z * (oy / core.topY));
    const dirAngleY = rng.range(0, Math.PI * 2);
    const riseAngle = rng.range(0.12, 0.55);
    const len = height * rng.range(0.22, 0.36) * (1 - t * 0.3);
    const r0 = baseR * rng.range(0.22, 0.34);
    const tips = buildBranch(rng, parts, origin, dirAngleY, riseAngle, len, r0);
    if (rng.bool(0.6)) {
      for (const tip of tips) {
        canopyParts.push(...buildCanopyClump(rng, tip.x, tip.y, tip.z, height * 0.16));
      }
    }
  }
  // A jagged broken-off stub near the top sells "blighted" even on the
  // otherwise-fullest variant.
  if (rng.bool(0.4)) {
    const stubY = core.topY * rng.range(0.7, 0.92);
    parts.push(cylinder(baseR * 0.05, baseR * 0.22, height * 0.1, 5, core.topPos.x * 0.4, stubY, core.topPos.z * 0.4, 0, rng.range(-0.3, 0.3)));
  }

  return {
    trunk: merge(parts),
    canopy: canopyParts.length ? merge(canopyParts) : null,
    height,
  };
}

/** A snapped, dead trunk -- no canopy, jagged fracture at the break. */
export function buildSnappedTreeGeometry(rng) {
  const height = rng.range(3.0, 5.6);
  const baseR = rng.range(0.28, 0.44);
  const core = buildTrunkCore(rng, { height, baseR, segs: 2, bend: 0.35 });
  const parts = [...core.parts];

  // Fractured top cap: a cluster of small shards angled outward from the
  // break point instead of a clean cylinder cap.
  const shardN = 4 + rng.int(0, 3);
  for (let i = 0; i < shardN; i++) {
    const a = (i / shardN) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const r = core.topR * rng.range(0.5, 0.95);
    const shardH = height * rng.range(0.06, 0.14);
    parts.push(box(
      core.topR * 0.5, shardH, core.topR * 0.5,
      core.topPos.x + Math.cos(a) * r * 0.5, core.topY + shardH * 0.4, core.topPos.z + Math.sin(a) * r * 0.5,
      a
    ));
  }
  // One long bare lateral branch remnant, low on the trunk.
  if (rng.bool(0.7)) {
    const origin = new THREE.Vector3(0, height * rng.range(0.3, 0.55), 0);
    buildBranch(rng, parts, origin, rng.range(0, Math.PI * 2), rng.range(-0.1, 0.2), height * rng.range(0.35, 0.55), baseR * 0.3);
  }

  return { trunk: merge(parts), canopy: null, height };
}

// ---------------------------------------------------------------------------
// placement
// ---------------------------------------------------------------------------

function treeDensityAt(terrain, wx, wz) {
  const slope = terrain.slopeAt(wx, wz);
  const path = terrain.pathAt(wx, wz);
  const water = terrain.waterAt(wx, wz);
  const edge = terrain.edgeAt(wx, wz);
  if (water > 0.3) return 0;
  if (slope > 0.34) return 0.02;

  // Patchy cover -- clearings and thickets, not a uniform lawn -- driven by
  // the same low-frequency base noise the terrain used, phase-shifted so
  // clearings don't line up 1:1 with hollows.
  const u = wx / terrain.worldSize, v = wz / terrain.worldSize;
  const cover = 0.35 + 0.65 * Math.pow(hashNoise(u * 5.3 + 11, v * 5.3 + 4), 1.4);

  let d = cover;
  d *= 1 - path * 0.94;
  d = Math.max(d, edge * 0.92); // dense sealed treeline at the boundary
  d *= 1 - THREE.MathUtils.clamp(slope * 1.6, 0, 0.6);
  return THREE.MathUtils.clamp(d, 0, 1);
}

/** Cheap deterministic 2D hash-noise (no tiling requirement here). */
function hashNoise(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function buildForestFoliage({ rng, terrain }) {
  const group = new THREE.Group();
  group.name = 'Foliage';
  const worldSize = terrain.worldSize;

  // A handful of *distinct* authored variants, each its own InstancedMesh --
  // merging different trees' geometry into one buffer would stack every
  // variant on top of every instance, so variety has to live in the count of
  // draw calls (still tiny) rather than in a single shared buffer.
  const fullVariants = [buildFullTreeGeometry(rng), buildFullTreeGeometry(rng), buildFullTreeGeometry(rng)];
  const snappedVariants = [buildSnappedTreeGeometry(rng), buildSnappedTreeGeometry(rng)];

  const barkMat = (terrain.materials?.bark || terrain.materials?.woodBeams || terrain.materials?.floor).clone();
  barkMat.color = new THREE.Color(0x38342a);
  barkMat.roughness = Math.min(1, (barkMat.roughness ?? 0.8) + 0.05);

  const leafMat = (terrain.materials?.deadLeaves || terrain.materials?.roughRock || terrain.materials?.floor).clone();
  leafMat.color = new THREE.Color(0x565f3e);
  leafMat.roughness = Math.min(1, (leafMat.roughness ?? 0.8));

  // --- placement pass: jittered grid, density-gated, hard-filtered by nav --
  const cellSize = 2.6;
  const cells = Math.round(worldSize / cellSize);

  const fullXf = fullVariants.map(() => []);
  const snappedXf = snappedVariants.map(() => []);
  let totalFull = 0, totalSnapped = 0;

  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const jitterX = rng.range(-0.5, 0.5);
      const jitterZ = rng.range(-0.5, 0.5);
      const wx = (i + 0.5 + jitterX) * cellSize;
      const wz = (j + 0.5 + jitterZ) * cellSize;
      if (wx < 1 || wz < 1 || wx > worldSize - 1 || wz > worldSize - 1) continue;

      const density = treeDensityAt(terrain, wx, wz);
      if (rng.next() >= density) continue;

      const snapped = rng.bool(0.16);
      const groundY = terrain.heightAt(wx, wz);
      const yaw = rng.range(0, Math.PI * 2);
      const scale = rng.range(0.78, 1.28);
      const lean = snapped ? rng.range(0.08, 0.28) : (rng.bool(0.22) ? rng.range(0.18, 0.42) : rng.range(0, 0.1));
      const leanDir = rng.range(0, Math.PI * 2);

      const q = new THREE.Quaternion();
      const qYaw = new THREE.Quaternion().setFromAxisAngle(_up, yaw);
      const leanAxis = new THREE.Vector3(Math.cos(leanDir), 0, Math.sin(leanDir));
      const qLean = new THREE.Quaternion().setFromAxisAngle(leanAxis, lean);
      q.multiplyQuaternions(qLean, qYaw);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(wx, groundY, wz), q, new THREE.Vector3(scale, scale, scale));
      const entry = { m, tint: rng.range(-0.06, 0.08) };

      if (snapped) {
        snappedXf[rng.int(0, snappedVariants.length - 1)].push(entry);
        totalSnapped++;
      } else {
        fullXf[rng.int(0, fullVariants.length - 1)].push(entry);
        totalFull++;
        if (scale > 0.95) terrain.markSolidDisc(wx, wz, 0.32 * scale);
      }
    }
  }

  for (let v = 0; v < fullVariants.length; v++) {
    const trunkMesh = makeInstancedMesh(fullVariants[v].trunk, barkMat, fullXf[v], `TreeTrunkFull${v}`);
    group.add(trunkMesh);
    if (fullVariants[v].canopy) {
      group.add(makeInstancedMesh(fullVariants[v].canopy, leafMat, fullXf[v], `TreeCanopy${v}`));
    }
  }
  for (let v = 0; v < snappedVariants.length; v++) {
    group.add(makeInstancedMesh(snappedVariants[v].trunk, barkMat, snappedXf[v], `TreeTrunkSnapped${v}`));
  }

  // --- the landmark: one hand-placed dead great-tree, bigger and unique ---
  const landmark = buildFullTreeGeometry(rng.fork ? rng.fork('greattree') : rng);
  const gtScale = 2.35;
  const gtPos = terrain.path.fork;
  const gtY = terrain.heightAt(gtPos.x, gtPos.z);
  const gtGroup = new THREE.Group();
  gtGroup.name = 'DeadGreatTree';
  const gtTrunk = new THREE.Mesh(landmark.trunk, barkMat.clone());
  gtTrunk.material.color = new THREE.Color(0x2e2a22);
  gtTrunk.castShadow = true; gtTrunk.receiveShadow = true;
  gtGroup.add(gtTrunk);
  if (landmark.canopy) {
    const gtCanopy = new THREE.Mesh(landmark.canopy, leafMat.clone());
    gtCanopy.material.color = new THREE.Color(0x4b5536);
    gtCanopy.castShadow = true;
    gtGroup.add(gtCanopy);
  }
  gtGroup.position.set(gtPos.x, gtY, gtPos.z);
  gtGroup.scale.setScalar(gtScale);
  group.add(gtGroup);
  terrain.markSolidDisc(gtPos.x, gtPos.z, 1.6 * gtScale * 0.4);

  const drawCalls = fullVariants.length + fullVariants.filter((v) => v.canopy).length
    + snappedVariants.length + (landmark.canopy ? 2 : 1);

  return {
    group,
    counts: { full: totalFull, snapped: totalSnapped, greatTree: 1 },
    drawCalls,
  };
}

export function makeInstancedMesh(geo, mat, transforms, name) {
  const count = Math.max(1, transforms.length);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const color = new THREE.Color();
  for (let i = 0; i < transforms.length; i++) {
    mesh.setMatrixAt(i, transforms[i].m);
    const t = 1 + (transforms[i].tint ?? 0);
    color.setRGB(t, t, t);
    mesh.setColorAt(i, color);
  }
  if (transforms.length === 0) mesh.count = 0;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// undergrowth: ferns, dead shrubs, dead-grass tufts
// ---------------------------------------------------------------------------

/** A small cluster of thin curled blades radiating from a point. */
function buildBladeClusterGeometry(rng, { count, height, curl, width }) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const h = height * rng.range(0.7, 1.15);
    const lean = rng.range(0.15, curl);
    const from = new THREE.Vector3(Math.cos(a) * width * 0.15, 0, Math.sin(a) * width * 0.15);
    const to = new THREE.Vector3(
      from.x + Math.cos(a) * Math.sin(lean) * h,
      h * Math.cos(lean),
      from.z + Math.sin(a) * Math.sin(lean) * h
    );
    const seg = orientedSegment(width * 0.02, width * 0.09, from, to, 3);
    if (seg) parts.push(seg);
  }
  return merge(parts);
}

function buildFallenLogGeometry(rng) {
  const len = rng.range(2.2, 4.2);
  const r = rng.range(0.18, 0.3);
  const parts = [
    cylinder(r, r * 1.08, len, 7, 0, r, 0, 0, Math.PI / 2),
    // cracked, slightly collapsed cross-section at one end
    sphere(r * 0.92, 6, 5, len / 2, r, 0, 0.8),
    sphere(r * 0.9, 6, 5, -len / 2, r, 0, 0.8),
  ];
  const n = 2 + rng.int(0, 2);
  for (let i = 0; i < n; i++) {
    const x = rng.range(-len * 0.4, len * 0.4);
    parts.push(box(r * 0.5, r * 0.35, r * 1.7, x, r * 1.7, rng.range(-r * 0.3, r * 0.3), rng.range(0, Math.PI)));
  }
  return merge(parts);
}

function buildRootSnagGeometry(rng) {
  const parts = [];
  const n = 3 + rng.int(0, 2);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const len = rng.range(0.5, 1.1);
    const from = new THREE.Vector3(0, 0.05, 0);
    const to = new THREE.Vector3(Math.cos(a) * len, len * rng.range(0.15, 0.4), Math.sin(a) * len);
    const seg = orientedSegment(0.03, 0.11, from, to, 5);
    if (seg) parts.push(seg);
  }
  return merge(parts);
}

function undergrowthDensityAt(terrain, wx, wz, kind) {
  const slope = terrain.slopeAt(wx, wz);
  const path = terrain.pathAt(wx, wz);
  const water = terrain.waterAt(wx, wz);
  if (water > 0.4 || slope > 0.32) return 0;
  const u = wx / terrain.worldSize, v = wz / terrain.worldSize;
  const patch = Math.pow(hashNoise(u * 8.1 + 31 + kind, v * 8.1 + 17), 1.2);
  return patch * (1 - path * 0.85) * (1 - slope * 2);
}

export function buildUndergrowth({ rng, terrain }) {
  const group = new THREE.Group();
  group.name = 'Undergrowth';
  const worldSize = terrain.worldSize;

  const fernMat = (terrain.materials?.deadLeaves || terrain.materials?.roughRock || terrain.materials?.floor).clone();
  fernMat.color = new THREE.Color(0x616a44);
  const shrubMat = (terrain.materials?.bark || terrain.materials?.woodBeams || terrain.materials?.floor).clone();
  shrubMat.color = new THREE.Color(0x342f26);
  const logMat = shrubMat.clone();
  logMat.color = new THREE.Color(0x3c3629);
  const rootMat = shrubMat.clone();
  rootMat.color = new THREE.Color(0x2c281f);

  const fernGeo = buildBladeClusterGeometry(rng, { count: 6, height: 0.55, curl: 0.9, width: 0.5 });
  const tuftGeo = buildBladeClusterGeometry(rng, { count: 8, height: 0.35, curl: 0.55, width: 0.4 });
  const shrubGeo = (() => {
    const parts = [];
    const n = 4 + rng.int(0, 3);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const len = rng.range(0.35, 0.75);
      const from = new THREE.Vector3(0, 0.05, 0);
      const to = new THREE.Vector3(Math.cos(a) * len * 0.5, len, Math.sin(a) * len * 0.5);
      const seg = orientedSegment(0.02, 0.05, from, to, 4);
      if (seg) parts.push(seg);
    }
    return merge(parts);
  })();
  const logGeo = buildFallenLogGeometry(rng);
  const rootGeo = buildRootSnagGeometry(rng);

  const placements = { fern: [], tuft: [], shrub: [], log: [], root: [] };
  const cellSize = 3.4;
  const cells = Math.round(worldSize / cellSize);

  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const wx = (i + 0.5 + rng.range(-0.5, 0.5)) * cellSize;
      const wz = (j + 0.5 + rng.range(-0.5, 0.5)) * cellSize;
      if (wx < 1 || wz < 1 || wx > worldSize - 1 || wz > worldSize - 1) continue;
      const groundY = terrain.heightAt(wx, wz);
      const yaw = rng.range(0, Math.PI * 2);

      const roll = rng.next();
      let kind = null;
      if (roll < 0.22 && undergrowthDensityAt(terrain, wx, wz, 1) > 0.35) kind = 'fern';
      else if (roll < 0.5 && undergrowthDensityAt(terrain, wx, wz, 2) > 0.3) kind = 'tuft';
      else if (roll < 0.6 && undergrowthDensityAt(terrain, wx, wz, 3) > 0.45) kind = 'shrub';
      else if (roll < 0.63 && undergrowthDensityAt(terrain, wx, wz, 4) > 0.55) kind = 'log';
      else if (roll < 0.68 && undergrowthDensityAt(terrain, wx, wz, 5) > 0.5) kind = 'root';
      if (!kind) continue;

      const scale = rng.range(0.75, 1.4);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(wx, groundY, wz),
        new THREE.Quaternion().setFromAxisAngle(_up, yaw),
        new THREE.Vector3(scale, scale, scale)
      );
      placements[kind].push({ m, tint: rng.range(-0.08, 0.1) });
    }
  }

  group.add(makeInstancedMesh(fernGeo, fernMat, placements.fern, 'Ferns'));
  group.add(makeInstancedMesh(tuftGeo, fernMat, placements.tuft, 'GrassTufts'));
  group.add(makeInstancedMesh(shrubGeo, shrubMat, placements.shrub, 'DeadShrubs'));
  group.add(makeInstancedMesh(logGeo, logMat, placements.log, 'FallenLogs'));
  group.add(makeInstancedMesh(rootGeo, rootMat, placements.root, 'RootSnags'));

  return {
    group,
    drawCalls: 5,
    counts: Object.fromEntries(Object.entries(placements).map(([k, v]) => [k, v.length])),
  };
}
