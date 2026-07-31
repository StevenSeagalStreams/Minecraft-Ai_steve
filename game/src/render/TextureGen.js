import * as THREE from 'three';

/**
 * Procedural texture synthesis.
 *
 * The game ships no image files. Every surface is generated at load time into
 * an OffscreenCanvas and uploaded as a tiling texture. Two reasons: the whole
 * build stays a single self-contained bundle, and a height field generated in
 * code can emit a *matched* normal/roughness/AO set, which is what actually
 * makes stone read as stone under a moving torch.
 */

// ---------------------------------------------------------------------------
// noise
// ---------------------------------------------------------------------------

/** Tileable value noise on an integer lattice with cosine interpolation. */
export function makeValueNoise(seed = 1) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const cache = new Map();
  const lattice = (period) => {
    let g = cache.get(period);
    if (g) return g;
    g = new Float32Array(period * period);
    for (let i = 0; i < g.length; i++) g[i] = rand();
    cache.set(period, g);
    return g;
  };

  return function noise(x, y, period) {
    const g = lattice(period);
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const wrap = (v) => ((v % period) + period) % period;
    const x0 = wrap(xi), y0 = wrap(yi);
    const x1 = wrap(xi + 1), y1 = wrap(yi + 1);
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = g[y0 * period + x0], b = g[y0 * period + x1];
    const c = g[y1 * period + x0], d = g[y1 * period + x1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
}

/** Tileable fractal Brownian motion. Returns [0,1]. */
export function fbm(noise, x, y, { octaves = 5, basePeriod = 4, lacunarity = 2, gain = 0.5 } = {}) {
  let amp = 1, sum = 0, norm = 0, period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * period, y * period, period) * amp;
    norm += amp;
    amp *= gain;
    period = Math.round(period * lacunarity);
  }
  return sum / norm;
}

/** Tileable Worley/cellular noise. Returns { f1, f2, id }. */
export function worley(x, y, period, seed = 0) {
  const hash = (i, j) => {
    let h = (i * 374761393 + j * 668265263 + seed * 1442695040888963407) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    return h >>> 0;
  };
  const px = x * period, py = y * period;
  const xi = Math.floor(px), yi = Math.floor(py);
  let f1 = Infinity, f2 = Infinity, id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy;
      const wx = ((cx % period) + period) % period;
      const wy = ((cy % period) + period) % period;
      const h = hash(wx, wy);
      const ox = ((h & 0xffff) / 65535);
      const oy = (((h >>> 16) & 0xffff) / 65535);
      const fx = cx + ox, fy = cy + oy;
      const d = Math.hypot(px - fx, py - fy);
      if (d < f1) { f2 = f1; f1 = d; id = h; }
      else if (d < f2) { f2 = d; }
    }
  }
  return { f1, f2, id };
}

// ---------------------------------------------------------------------------
// canvas plumbing
// ---------------------------------------------------------------------------

export function createCanvas(size) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/**
 * Run a per-pixel generator over a square image.
 * @param {(u:number,v:number,x:number,y:number)=>[number,number,number,number?]} fn
 */
export function generateImage(size, fn) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const [r, g, b, a] = fn(x / size, y / size, x, y);
      data[i] = r * 255;
      data[i + 1] = g * 255;
      data[i + 2] = b * 255;
      data[i + 3] = (a ?? 1) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Generate a Float32Array height field, which downstream maps derive from. */
export function generateHeight(size, fn) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) h[y * size + x] = fn(x / size, y / size, x, y);
  }
  return h;
}

/**
 * Sobel a height field into a tangent-space normal map.
 * `strength` is in height-units per texel; higher = more pronounced relief.
 */
export function heightToNormal(height, size, strength = 2.2) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const at = (x, y) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);

      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);

      let nx = -dx * strength;
      let ny = -dy * strength;
      let nz = 1.0;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;

      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Cheap screen-space-style AO baked from a height field (concavity estimate). */
export function heightToAO(height, size, radius = 4, strength = 1.0) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const at = (x, y) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];

  const samples = [];
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    samples.push([Math.cos(ang), Math.sin(ang)]);
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const h0 = at(x, y);
      let occ = 0;
      for (const [sx, sy] of samples) {
        let maxSlope = 0;
        for (let s = 1; s <= radius; s++) {
          const hs = at(Math.round(x + sx * s), Math.round(y + sy * s));
          maxSlope = Math.max(maxSlope, (hs - h0) / s);
        }
        occ += Math.max(0, maxSlope);
      }
      occ = 1 - Math.min(1, (occ / samples.length) * 6 * strength);
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = occ * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ---------------------------------------------------------------------------
// texture wrapping
// ---------------------------------------------------------------------------

export function toTexture(canvas, { srgb = false, repeat = 1, aniso = 16 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = aniso;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
