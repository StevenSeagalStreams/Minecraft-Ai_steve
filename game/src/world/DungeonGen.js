import { RNG } from '../core/RNG.js';

export const CELL = {
  ROCK: 0,   // solid, never rendered as interior
  FLOOR: 1,
  WALL: 2,   // solid cell adjacent to at least one floor cell
  DOOR: 3,
};

/**
 * Grid dungeon generator: room placement + corridor carving + wall derivation.
 *
 * Deliberately not a pure BSP. BSP fills the rectangle it is given, which makes
 * every level read as one big block. Diablo's catacombs feel like something
 * *dug*, so we scatter rooms with rejection sampling, leave rock between them,
 * and connect with dog-legged corridors that occasionally wander.
 */
export class DungeonGen {
  constructor(opts = {}) {
    this.width = opts.width ?? 96;
    this.height = opts.height ?? 96;
    this.rng = opts.rng instanceof RNG ? opts.rng : new RNG(opts.seed ?? 1337);

    this.roomAttempts = opts.roomAttempts ?? 220;
    this.minRoom = opts.minRoom ?? 6;
    this.maxRoom = opts.maxRoom ?? 15;
    this.roomPadding = opts.roomPadding ?? 2;
    this.extraLoopChance = opts.extraLoopChance ?? 0.18;
    this.corridorWander = opts.corridorWander ?? 0.30;
  }

  generate() {
    const { width: W, height: H, rng } = this;
    const grid = new Uint8Array(W * H); // CELL.ROCK everywhere
    const at = (x, y) => y * W + x;

    /** @type {{x:number,y:number,w:number,h:number,cx:number,cy:number,id:number,kind:string}[]} */
    const rooms = [];

    for (let attempt = 0; attempt < this.roomAttempts; attempt++) {
      // Bias toward non-square rooms; long halls read better in an iso view.
      let w = rng.int(this.minRoom, this.maxRoom);
      let h = rng.int(this.minRoom, this.maxRoom);
      if (rng.bool(0.35)) {
        if (rng.bool()) w = Math.min(this.maxRoom + 6, Math.round(w * 1.7));
        else h = Math.min(this.maxRoom + 6, Math.round(h * 1.7));
      }

      const x = rng.int(2, W - w - 3);
      const y = rng.int(2, H - h - 3);

      const pad = this.roomPadding;
      let overlaps = false;
      for (const r of rooms) {
        if (
          x - pad < r.x + r.w && x + w + pad > r.x &&
          y - pad < r.y + r.h && y + h + pad > r.y
        ) { overlaps = true; break; }
      }
      if (overlaps) continue;

      rooms.push({
        x, y, w, h,
        cx: Math.floor(x + w / 2),
        cy: Math.floor(y + h / 2),
        id: rooms.length,
        kind: 'room',
      });
    }

    if (rooms.length === 0) throw new Error('DungeonGen: produced no rooms');

    for (const r of rooms) {
      for (let yy = r.y; yy < r.y + r.h; yy++) {
        for (let xx = r.x; xx < r.x + r.w; xx++) grid[at(xx, yy)] = CELL.FLOOR;
      }
    }

    // --- connectivity -------------------------------------------------------
    // Minimum spanning tree over room centres (guarantees the level is
    // completable), then a few extra edges so the map has loops instead of
    // being a strict tree that forces backtracking.
    const connected = [rooms[0]];
    const pending = rooms.slice(1);
    const corridors = [];

    while (pending.length) {
      let best = null;
      for (const a of connected) {
        for (let i = 0; i < pending.length; i++) {
          const b = pending[i];
          const d = (a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2;
          if (!best || d < best.d) best = { a, b, i, d };
        }
      }
      this._carveCorridor(grid, best.a, best.b);
      corridors.push([best.a.id, best.b.id]);
      connected.push(best.b);
      pending.splice(best.i, 1);
    }

    for (const a of rooms) {
      if (!rng.bool(this.extraLoopChance)) continue;
      const b = rng.pick(rooms);
      if (b === a) continue;
      this._carveCorridor(grid, a, b);
      corridors.push([a.id, b.id]);
    }

    // --- wall derivation ----------------------------------------------------
    // Any solid cell touching a floor cell (8-neighbourhood) becomes a wall.
    // The 8-neighbourhood matters: 4 leaves diagonal pinholes you can see
    // straight through at this camera angle.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (grid[at(x, y)] !== CELL.ROCK) continue;
        let touching = false;
        for (let dy = -1; dy <= 1 && !touching; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            if (grid[at(nx, ny)] === CELL.FLOOR) { touching = true; break; }
          }
        }
        if (touching) grid[at(x, y)] = CELL.WALL;
      }
    }

    // --- room roles ---------------------------------------------------------
    const sorted = rooms.slice().sort((a, b) => b.w * b.h - a.w * a.h);
    sorted[0].kind = 'hall';
    let far = rooms[0], farD = -1;
    for (const r of rooms) {
      const d = (r.cx - sorted[0].cx) ** 2 + (r.cy - sorted[0].cy) ** 2;
      if (d > farD) { farD = d; far = r; }
    }
    far.kind = 'boss';

    // Entrance is the room furthest from the boss.
    let entrance = rooms[0], entD = -1;
    for (const r of rooms) {
      const d = (r.cx - far.cx) ** 2 + (r.cy - far.cy) ** 2;
      if (d > entD) { entD = d; entrance = r; }
    }
    entrance.kind = 'entrance';

    for (const r of rooms) {
      if (r.kind !== 'room') continue;
      if (rng.bool(0.14)) r.kind = 'treasure';
      else if (rng.bool(0.12)) r.kind = 'shrine';
    }

    return {
      width: W,
      height: H,
      grid,
      rooms,
      corridors,
      entrance,
      boss: far,
      seed: this.rng.seed,
      at,
      isFloor: (x, y) =>
        x >= 0 && y >= 0 && x < W && y < H && grid[y * W + x] === CELL.FLOOR,
      isSolid: (x, y) =>
        x < 0 || y < 0 || x >= W || y >= H || grid[y * W + x] !== CELL.FLOOR,
    };
  }

  _carveCorridor(grid, a, b) {
    const W = this.width, H = this.height, rng = this.rng;
    const at = (x, y) => y * W + x;

    let x = a.cx, y = a.cy;
    const tx = b.cx, ty = b.cy;

    // Corridors are 2 cells wide (or 3 occasionally). One-cell corridors read
    // as cracks at a 34 degree camera -- you cannot see the character in them.
    const halfWidth = rng.bool(0.22) ? 1 : 0;
    const paint = (px, py) => {
      for (let dy = -halfWidth; dy <= halfWidth + 1; dy++) {
        for (let dx = -halfWidth; dx <= halfWidth + 1; dx++) {
          const nx = px + dx, ny = py + dy;
          if (nx > 0 && ny > 0 && nx < W - 1 && ny < H - 1) grid[at(nx, ny)] = CELL.FLOOR;
        }
      }
    };

    let horizontalFirst = rng.bool();
    let guard = 0;
    while ((x !== tx || y !== ty) && guard++ < 4000) {
      paint(x, y);
      // Occasional axis flip mid-run gives staircase corridors rather than
      // the tell-tale single L of every roguelike tutorial.
      if (rng.bool(this.corridorWander * 0.1)) horizontalFirst = !horizontalFirst;

      if (horizontalFirst) {
        if (x !== tx) x += Math.sign(tx - x);
        else if (y !== ty) y += Math.sign(ty - y);
      } else {
        if (y !== ty) y += Math.sign(ty - y);
        else if (x !== tx) x += Math.sign(tx - x);
      }
    }
    paint(tx, ty);
  }
}
