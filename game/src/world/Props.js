/**
 * Level dressing: braziers, rubble, bones, pillars, arches, chains, banners,
 * sarcophagi, broken flagstones, cobwebs.
 *
 * Called once after the level geometry is built. Must respect the collision
 * grid (do not block corridors) and must instance anything placed more than a
 * handful of times.
 *
 * STUB -- replaced by the world pass.
 */
export function decorate(_ctx) {
  return { group: null, update(_dt) {} };
}
