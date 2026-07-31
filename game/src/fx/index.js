/**
 * VFX subsystem entry point.
 *
 * `main.js` constructs this once and calls `update(dt)` in the fx phase. The
 * subsystem owns everything visual that is not level geometry, characters, or
 * UI: particles, decals, blood, trails, spell impacts, ambient motes.
 *
 * Subscribe to bus events rather than being called directly, so combat code
 * never needs to know what an effect looks like.
 *
 * STUB -- replaced by the vfx pass.
 */
export function createFX(ctx) {
  const { bus } = ctx;

  const off = [
    bus.on('combat:hit', () => {}),
    bus.on('entity:died', () => {}),
    bus.on('fx:request', () => {}),
  ];

  return {
    update(_dt) {},
    dispose() { off.forEach((f) => f()); },
  };
}
