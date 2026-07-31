import * as THREE from 'three';
import {
  makeValueNoise, fbm, worley, generateImage, generateHeight,
  heightToNormal, heightToAO, toTexture,
} from './TextureGen.js';

/**
 * Material library. Each recipe generates a height field first, then derives
 * albedo, normal, roughness and AO from that single field so all four agree.
 * Deriving them independently is the classic mistake -- you get normals that
 * point at cracks the albedo does not have, and the surface looks like a decal
 * rather than geometry.
 */
export class MaterialLibrary {
  constructor(opts = {}) {
    this.size = opts.size ?? 512;
    this.anisotropy = opts.anisotropy ?? 16;
    this.cache = new Map();
  }

  async build() {
    this.floor = this._flagstone();
    this.wall = this._blockWall();
    return this;
  }

  /** Worn flagstone: irregular slabs, mortar valleys, worn-smooth centres. */
  _flagstone() {
    const S = this.size;
    const noise = makeValueNoise(0x51a7);

    const height = generateHeight(S, (u, v) => {
      const { f1, f2 } = worley(u, v, 6, 11);
      const edge = Math.min(1, (f2 - f1) * 3.2);         // 0 at slab borders
      const mortar = Math.pow(edge, 0.55);
      const grain = fbm(noise, u, v, { octaves: 6, basePeriod: 8 }) * 0.22;
      const pit = Math.pow(fbm(noise, u + 3.1, v + 7.7, { octaves: 4, basePeriod: 24 }), 4) * 0.5;
      return mortar * 0.8 + grain - pit;
    });

    const normal = heightToNormal(height, S, 2.6);
    const ao = heightToAO(height, S, 5, 1.15);

    const albedo = generateImage(S, (u, v, x, y) => {
      const h = height[y * S + x];
      const { id } = worley(u, v, 6, 11);
      // per-slab tint so adjacent stones differ like real quarried rock
      const slab = ((id & 0xff) / 255 - 0.5) * 0.16;
      const grime = fbm(noise, u * 1.3 + 5, v * 1.3 + 2, { octaves: 5, basePeriod: 6 });
      const base = 0.30 + h * 0.22 + slab;
      const r = base * (1.02 + grime * 0.10);
      const g = base * (0.97 + grime * 0.06);
      const b = base * (0.90 + grime * 0.02);
      return [r, g, b];
    });

    const rough = generateImage(S, (u, v, x, y) => {
      const h = height[y * S + x];
      // Slab centres are polished by centuries of boots; mortar stays rough.
      const polish = Math.pow(Math.max(0, h), 1.5);
      const r = THREE.MathUtils.clamp(0.94 - polish * 0.42, 0.35, 1.0);
      return [r, r, r];
    });

    return new THREE.MeshStandardMaterial({
      map: toTexture(albedo, { srgb: true, repeat: 1, aniso: this.anisotropy }),
      normalMap: toTexture(normal, { repeat: 1, aniso: this.anisotropy }),
      roughnessMap: toTexture(rough, { repeat: 1, aniso: this.anisotropy }),
      aoMap: toTexture(ao, { repeat: 1, aniso: this.anisotropy }),
      normalScale: new THREE.Vector2(1.15, 1.15),
      aoMapIntensity: 1.0,
      roughness: 1.0,
      metalness: 0.0,
      color: 0xffffff,
      envMapIntensity: 0.5,
    });
  }

  /** Cut-block masonry: courses of rectangular blocks with deep joints. */
  _blockWall() {
    const S = this.size;
    const noise = makeValueNoise(0x9f31);

    const height = generateHeight(S, (u, v) => {
      const courses = 6;
      const row = Math.floor(v * courses);
      // running bond: every other course offsets by half a block
      const offset = (row % 2) * 0.5;
      const bx = (u * 4 + offset) % 1;
      const by = (v * courses) % 1;

      const jointX = Math.min(bx, 1 - bx);
      const jointY = Math.min(by, 1 - by);
      const joint = Math.min(smooth(jointX, 0.0, 0.055), smooth(jointY, 0.0, 0.10));

      const face = fbm(noise, u * 2, v * 2, { octaves: 6, basePeriod: 10 }) * 0.30;
      const chip = Math.pow(fbm(noise, u + 11, v + 4, { octaves: 3, basePeriod: 30 }), 5) * 0.7;
      return joint * 0.85 + face - chip;
    });

    const normal = heightToNormal(height, S, 3.0);
    const ao = heightToAO(height, S, 6, 1.35);

    const albedo = generateImage(S, (u, v, x, y) => {
      const h = height[y * S + x];
      const damp = fbm(noise, u * 0.7 + 21, v * 0.7 + 13, { octaves: 4, basePeriod: 4 });
      // Water seeps down masonry; darken with a downward bias.
      const seep = Math.pow(damp, 2.2) * (0.35 + v * 0.4);
      const base = (0.26 + h * 0.20) * (1 - seep * 0.45);
      const moss = Math.max(0, fbm(noise, u * 1.9 + 3, v * 1.9 + 9, { octaves: 4, basePeriod: 12 }) - 0.62) * 1.6;
      const r = base * (1.0 - moss * 0.35);
      const g = base * (1.0 + moss * 0.25);
      const b = base * (0.94 - moss * 0.10);
      return [r, g, b];
    });

    const rough = generateImage(S, (u, v, x, y) => {
      const h = height[y * S + x];
      const damp = fbm(noise, u * 0.7 + 21, v * 0.7 + 13, { octaves: 4, basePeriod: 4 });
      // Damp patches are glossier -- the cue that sells "underground".
      const r = THREE.MathUtils.clamp(0.96 - Math.pow(damp, 2.2) * 0.40 - h * 0.10, 0.34, 1.0);
      return [r, r, r];
    });

    return new THREE.MeshStandardMaterial({
      map: toTexture(albedo, { srgb: true, aniso: this.anisotropy }),
      normalMap: toTexture(normal, { aniso: this.anisotropy }),
      roughnessMap: toTexture(rough, { aniso: this.anisotropy }),
      aoMap: toTexture(ao, { aniso: this.anisotropy }),
      normalScale: new THREE.Vector2(1.3, 1.3),
      roughness: 1.0,
      metalness: 0.0,
      envMapIntensity: 0.4,
    });
  }
}

function smooth(x, a, b) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
