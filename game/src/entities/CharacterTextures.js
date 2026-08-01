import * as THREE from 'three';
import * as TextureGen from '../render/TextureGen.js';

/**
 * Procedural PBR texture sets for character materials, built from TextureGen
 * primitives (owned by the rendering pass, read-only here). Every call is
 * wrapped defensively: TextureGen is someone else's file and may grow or
 * change shape under us, so a missing/renamed export degrades to a flat
 * material instead of throwing at load time.
 */

const cache = new Map();

function has(name) { return typeof TextureGen[name] === 'function'; }

function safeNoise(seed) {
  if (has('makeValueNoise')) {
    try { return TextureGen.makeValueNoise(seed); } catch { /* fall through */ }
  }
  return () => 0.5;
}

function safeFbm(noise, x, y, opts) {
  if (has('fbm')) {
    try { return TextureGen.fbm(noise, x, y, opts); } catch { /* fall through */ }
  }
  return 0.5;
}

function safeWorley(x, y, period, seed) {
  if (has('worley')) {
    try { return TextureGen.worley(x, y, period, seed); } catch { /* fall through */ }
  }
  return { f1: 0.5, f2: 0.5, id: 0 };
}

function safeHeight(size, fn) {
  if (has('generateHeight')) {
    try { return TextureGen.generateHeight(size, fn); } catch { /* fall through */ }
  }
  return null;
}

function safeImage(size, fn) {
  if (has('generateImage')) {
    try { return TextureGen.generateImage(size, fn); } catch { /* fall through */ }
  }
  return null;
}

function safeNormal(height, size, strength) {
  if (height && has('heightToNormal')) {
    try { return TextureGen.heightToNormal(height, size, strength); } catch { /* fall through */ }
  }
  return null;
}

function safeAO(height, size, radius, strength) {
  if (height && has('heightToAO')) {
    try { return TextureGen.heightToAO(height, size, radius, strength); } catch { /* fall through */ }
  }
  return null;
}

function safeTexture(canvas, opts) {
  if (canvas && has('toTexture')) {
    try { return TextureGen.toTexture(canvas, opts); } catch { /* fall through */ }
  }
  return null;
}

/** Brushed steel with scratch wear, dents, and darker recesses. */
function buildMetalMaps(seed, size = 256) {
  const noise = safeNoise(seed);
  const height = safeHeight(size, (u, v) => {
    const brushed = Math.sin(u * 90 + safeFbm(noise, u * 3, v * 3, { octaves: 3, basePeriod: 6 }) * 4) * 0.02;
    const scratches = Math.pow(safeFbm(noise, u * 5 + 3, v * 5 + 1, { octaves: 4, basePeriod: 10 }), 6) * 0.6;
    const dents = Math.pow(Math.max(0, 1 - safeWorley(u, v, 5, 41).f1 * 1.4), 3) * -0.35;
    return brushed + scratches + dents;
  });
  const normal = safeNormal(height, size, 1.4);
  const ao = safeAO(height, size, 4, 0.6);
  const albedo = safeImage(size, (u, v, x, y) => {
    const h = height ? height[y * size + x] : 0;
    const wear = Math.max(0, h) * 0.5;
    const base = 0.62 + wear;
    return [base, base * 0.99, base * 0.95];
  });
  const rough = safeImage(size, (u, v, x, y) => {
    const h = height ? height[y * size + x] : 0;
    const r = THREE.MathUtils.clamp(0.36 - h * 0.30, 0.08, 0.7);
    return [r, r, r];
  });
  return {
    map: safeTexture(albedo, { srgb: true, repeat: 1 }),
    normalMap: safeTexture(normal, { repeat: 1 }),
    roughnessMap: safeTexture(rough, { repeat: 1 }),
    aoMap: safeTexture(ao, { repeat: 1 }),
  };
}

/** Woven cloth: matte, low-frequency thread bumps, no sheen. */
function buildClothMaps(seed, size = 256) {
  const noise = safeNoise(seed);
  const height = safeHeight(size, (u, v) => {
    const weaveX = Math.sin(u * 140) * 0.15;
    const weaveY = Math.sin(v * 140 + Math.PI / 2) * 0.15;
    const grime = safeFbm(noise, u * 2 + 7, v * 2 + 3, { octaves: 4, basePeriod: 8 }) * 0.4;
    return weaveX * weaveY * 0.5 + grime;
  });
  const normal = safeNormal(height, size, 0.9);
  const ao = safeAO(height, size, 3, 0.5);
  const albedo = safeImage(size, (u, v, x, y) => {
    const grime = safeFbm(noise, u * 1.4 + 11, v * 1.4 + 5, { octaves: 4, basePeriod: 6 });
    const base = 0.5 - grime * 0.18;
    return [base, base, base];
  });
  const rough = safeImage(size, () => [0.92, 0.92, 0.92]);
  return {
    map: safeTexture(albedo, { srgb: true, repeat: 1 }),
    normalMap: safeTexture(normal, { repeat: 1 }),
    roughnessMap: safeTexture(rough, { repeat: 1 }),
    aoMap: safeTexture(ao, { repeat: 1 }),
  };
}

/** Bone: mottled porosity, faint sheen at the ridges. */
function buildBoneMaps(seed, size = 192) {
  const noise = safeNoise(seed);
  const height = safeHeight(size, (u, v) => {
    const porous = Math.pow(safeWorley(u, v, 14, 71).f1, 2) * 0.5;
    const crack = Math.pow(safeFbm(noise, u * 4, v * 4, { octaves: 4, basePeriod: 12 }), 5) * 0.6;
    return porous - crack;
  });
  const normal = safeNormal(height, size, 1.1);
  const ao = safeAO(height, size, 3, 0.7);
  const albedo = safeImage(size, (u, v, x, y) => {
    const stain = safeFbm(noise, u * 1.8 + 2, v * 1.8 + 9, { octaves: 4, basePeriod: 10 });
    const base = 0.72 - stain * 0.14;
    return [base, base * 0.96, base * 0.86];
  });
  return {
    map: safeTexture(albedo, { srgb: true, repeat: 1 }),
    normalMap: safeTexture(normal, { repeat: 1 }),
    aoMap: safeTexture(ao, { repeat: 1 }),
  };
}

function cached(key, build) {
  if (cache.has(key)) return cache.get(key);
  let maps;
  try { maps = build(); } catch { maps = {}; }
  cache.set(key, maps);
  return maps;
}

export function metalMaps(seed = 1) { return cached(`metal:${seed}`, () => buildMetalMaps(seed)); }
export function clothMaps(seed = 1) { return cached(`cloth:${seed}`, () => buildClothMaps(seed)); }
export function boneMaps(seed = 1) { return cached(`bone:${seed}`, () => buildBoneMaps(seed)); }
