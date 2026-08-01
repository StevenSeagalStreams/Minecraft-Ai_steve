import * as THREE from 'three';
import { NavGrid } from '../Nav.js';
import { TILE } from '../LevelBuilder.js';

/**
 * Zone 1 -- the Blighted Forest.  *** M1 TARGET ZONE ***
 *
 * The WoW pillar lives here: a readable outdoor space with strong zone
 * identity, silhouette-driven treelines, and a low sun that rakes across
 * terrain. The Diablo pillar keeps it oppressive rather than pastoral -- this
 * is Elwynn Forest after something went wrong in it.
 *
 * Art direction targets:
 *   - Low-angle key from a sickly amber sun near the horizon, long shadows.
 *   - Cool desaturated blue-green ambient; the palette is sick, not lush.
 *   - Ground plane is heightmapped, never flat. Ridges, hollows, a path worn
 *     through the middle that the eye can follow.
 *   - Treelines read as silhouette masses first, individual trees second.
 *   - Volumetric ground fog pooling in the hollows; god rays through canopy.
 *   - Blight: dead bark, curled leaves, ash drift, sickly fungal accents as
 *     the single saturated colour note.
 *
 * STUB -- owned and implemented by the Terrain & Environment agent.
 * The contract below is what the game loop consumes; keep these fields.
 */
export async function createForest(ctx) {
  const { scene, rng } = ctx;

  const group = new THREE.Group();
  group.name = 'Zone:forest';

  // Placeholder flat ground so the game still boots before the terrain pass
  // lands. The Terrain agent replaces everything in this function.
  const SIZE = 96;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE * TILE, SIZE * TILE, 1, 1),
    ctx.materials?.floor || new THREE.MeshStandardMaterial({ color: 0x2c3326, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((SIZE * TILE) / 2, 0, (SIZE * TILE) / 2);
  ground.receiveShadow = true;
  group.add(ground);

  // Open navigation grid over the whole area.
  const solid = new Uint8Array(SIZE * SIZE);
  const colliders = {
    width: SIZE,
    height: SIZE,
    solid,
    isSolidCell: (x, y) => x < 0 || y < 0 || x >= SIZE || y >= SIZE || solid[y * SIZE + x] === 1,
    isBlocked(wx, wz, radius = 0.45) {
      const minX = Math.round((wx - radius) / TILE);
      const maxX = Math.round((wx + radius) / TILE);
      const minY = Math.round((wz - radius) / TILE);
      const maxY = Math.round((wz + radius) / TILE);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (this.isSolidCell(x, y)) {
            const cx = x * TILE, cy = y * TILE;
            const nx = Math.max(cx - TILE / 2, Math.min(wx, cx + TILE / 2));
            const ny = Math.max(cy - TILE / 2, Math.min(wz, cy + TILE / 2));
            const dx = wx - nx, dy = wz - ny;
            if (dx * dx + dy * dy < radius * radius) return true;
          }
        }
      }
      return false;
    },
  };

  const centre = (SIZE * TILE) / 2;
  const spawns = [];
  for (let i = 0; i < 14; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(10, 34);
    spawns.push({
      kind: rng.bool(0.5) ? 'swarmer' : 'skeleton',
      position: new THREE.Vector3(centre + Math.sin(a) * r, 0, centre + Math.cos(a) * r),
    });
  }

  scene.add(group);

  return {
    name: 'forest',
    group,
    colliders,
    nav: new NavGrid(colliders),
    spawns,
    spawnPoint: new THREE.Vector3(centre, 0, centre),
    bounds: { minX: 0, maxX: SIZE * TILE, minZ: 0, maxZ: SIZE * TILE },
    // Sick amber-and-slate exterior: desaturated, cold shadows, warm low sun.
    fog: { color: 0x39423f, density: 0.0075 },
    grade: {
      exposure: 1.15, contrast: 1.08, saturation: 0.88,
      lift: [0.010, 0.014, 0.016],
      gain: [1.03, 1.00, 0.92],
      shadowTint: [0.32, 0.44, 0.58], shadowTintAmt: 0.20,
      highlightTint: [1.00, 0.82, 0.52], highlightAmt: 0.16,
      vignette: 0.66,
    },
    lightRig: {
      sunColor: 0xffb066,
      sunIntensity: 2.6,
      sunElevation: 14,     // degrees above horizon -- long raking shadows
      sunAzimuth: 232,
      ambientColor: 0x36434c,
      ambientIntensity: 0.55,
      hemiSky: 0x53606b,
      hemiGround: 0x241f18,
      hemiIntensity: 0.75,
    },
    update(_dt) {},
  };
}
