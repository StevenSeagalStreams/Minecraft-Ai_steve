import { ZERO } from '../../math/decimal';
import {
  amountOf,
  freshState,
  modifiersOf,
  withGenerator,
  withUpgrade,
} from '../../testing/helpers';
import { TEST_CONFIG } from '../../testing/testConfig';
import { gatherAmount, manualGather } from '../idle/gather';
import { resourceRate } from '../idle/production';

const config = TEST_CONFIG;
// baseAmount 1, secondsOfProduction 0.5, gold.
const gather = (state: Parameters<typeof manualGather>[0]) =>
  manualGather(state, config, modifiersOf(state));

describe('manual gather', () => {
  it('yields the flat base with no production', () => {
    const state = freshState();
    expect(gatherAmount(state, config, modifiersOf(state)).eq(1)).toBe(true);
  });

  it('adds a slice of current output', () => {
    // 4 generators at 1/s = 4/s; half a second of that is 2, plus the base.
    const state = withGenerator(freshState(), 'g1', 4);
    expect(gatherAmount(state, config, modifiersOf(state)).eq(3)).toBe(true);
  });

  it('scales the flat base with the global multiplier', () => {
    const state = withUpgrade(freshState(), 'boost', 3);
    expect(gatherAmount(state, config, modifiersOf(state)).eq(8)).toBe(true);
  });

  it('credits the resource and its lifetime totals', () => {
    const result = gather(freshState());
    expect(result.gained.eq(1)).toBe(true);
    expect(amountOf(result.state, 'gold').eq(1)).toBe(true);
    expect(result.state.resources.gold?.lifetimeEarned.eq(1)).toBe(true);
    expect(result.state.resources.gold?.runEarned.eq(1)).toBe(true);
  });

  it('accumulates across taps', () => {
    let state = freshState();
    for (let index = 0; index < 5; index += 1) state = gather(state).state;
    expect(amountOf(state, 'gold').eq(5)).toBe(true);
  });

  it('never mutates the input state', () => {
    const state = freshState();
    gather(state);
    expect(amountOf(state, 'gold').eq(ZERO)).toBe(true);
  });

  it('stays negligible once generators dominate', () => {
    const state = withGenerator(freshState(), 'g1', '1e12');
    const modifiers = modifiersOf(state);
    const tap = gatherAmount(state, config, modifiers);
    const perSecond = resourceRate(state, config, modifiers, 'gold');

    // A tap is worth a fixed fraction of a second of output plus a flat base,
    // so it can never overtake idle income however large the numbers get.
    expect(tap.lt(perSecond)).toBe(true);
    expect(tap.div(perSecond).lt(0.51)).toBe(true);
  });
});
