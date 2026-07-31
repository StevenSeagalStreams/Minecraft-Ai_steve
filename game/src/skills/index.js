/**
 * Skills subsystem entry point.
 *
 * Owns the skill definitions, cooldowns, resource costs, the skill tree and
 * its allocation state, and the hotbar binding that turns a keypress into a
 * cast. Visual results are requested via `fx:request` rather than created here.
 *
 * STUB -- replaced by the combat/skills pass.
 */
export function createSkills(ctx) {
  return {
    update(_dt) {},
    cast(_slot) { return false; },
    dispose() {},
  };
}
