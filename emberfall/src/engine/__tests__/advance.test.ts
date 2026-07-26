import { amountOf, freshState, snapshot, withGenerator } from '../../testing/helpers';
import { TEST_CONFIG, TEST_EPOCH } from '../../testing/testConfig';
import { advance } from '../advance';

const config = TEST_CONFIG;

describe('advance', () => {
  it('ticks normally for a short gap', () => {
    const state = withGenerator(freshState(), 'g1', 2);
    const result = advance(state, TEST_EPOCH + 1_000, config);
    expect(result.drift.kind).toBe('normal');
    expect(result.offline).toBeNull();
    expect(amountOf(result.state, 'gold').eq(2)).toBe(true);
    expect(result.state.lastTickAt).toBe(TEST_EPOCH + 1_000);
  });

  it('routes a long gap through offline progress', () => {
    const state = withGenerator(freshState(), 'g1', 2);
    const result = advance(state, TEST_EPOCH + 600_000, config);
    expect(result.drift.kind).toBe('forwardJump');
    expect(result.offline?.applied).toBe(true);
    // 2/s * 600s * 0.5 efficiency
    expect(amountOf(result.state, 'gold').eq(600)).toBe(true);
  });

  it('awards nothing but still resynchronises a backward clock', () => {
    const state = withGenerator(freshState(), 'g1', 2);
    const result = advance(state, TEST_EPOCH - 60_000, config);
    expect(result.drift.kind).toBe('backward');
    expect(amountOf(result.state, 'gold').eq(0)).toBe(true);
    expect(result.state.lastTickAt).toBe(TEST_EPOCH - 60_000);
  });

  it('cannot be farmed by winding the clock back and forth', () => {
    const state = withGenerator(freshState(), 'g1', 10);
    const forward = advance(state, TEST_EPOCH + 1_000, config).state;
    const rewound = advance(forward, TEST_EPOCH, config).state;
    const forwardAgain = advance(rewound, TEST_EPOCH + 1_000, config).state;
    // Two honest seconds of production, not three.
    expect(amountOf(forwardAgain, 'gold').eq(20)).toBe(true);
  });

  it('is deterministic across identical timestamp sequences', () => {
    const state = withGenerator(freshState(), 'g1', 5);
    const run = (): string => {
      let current = state;
      for (const offset of [500, 1_200, 4_000, 90_000, 90_500]) {
        current = advance(current, TEST_EPOCH + offset, config).state;
      }
      return snapshot(current);
    };
    expect(run()).toBe(run());
  });

  it('advances lastTickAt even when nothing is produced', () => {
    const result = advance(freshState(), TEST_EPOCH + 10, config);
    expect(result.state.lastTickAt).toBe(TEST_EPOCH + 10);
  });
});

describe('advance — gaps between the drift threshold and the offline minimum', () => {
  /**
   * The drift threshold and the offline minimum are independent config values.
   * When they are tuned apart, a gap can be long enough to be routed to offline
   * but too short for offline to accept it. That window must still be credited.
   */
  const split = {
    ...config,
    time: { ...config.time, maxForwardDriftMs: 1_000 },
    offline: { ...config.offline, minElapsedMs: 60_000 },
  };

  it('falls back to a tick instead of dropping the elapsed time', () => {
    const state = withGenerator(freshState(split), 'g1', 2);
    const result = advance(state, TEST_EPOCH + 3_000, split);

    expect(result.drift.kind).toBe('forwardJump');
    expect(result.offline?.applied).toBe(false);
    expect(result.tick).not.toBeNull();
    // 2/s for 3s at full efficiency — credited as a tick, not silently lost.
    expect(amountOf(result.state, 'gold').eq(6)).toBe(true);
  });

  it('still advances the clock in the fallback path', () => {
    const state = withGenerator(freshState(split), 'g1', 2);
    const result = advance(state, TEST_EPOCH + 3_000, split);
    expect(result.state.lastTickAt).toBe(TEST_EPOCH + 3_000);
  });
});
