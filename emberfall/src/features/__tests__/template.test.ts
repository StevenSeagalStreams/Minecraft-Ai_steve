import { freshState, withGenerator, withResource } from '../../testing/helpers';
import { TEST_CONFIG } from '../../testing/testConfig';
import { interpolate } from '../story/template';

const config = TEST_CONFIG;

describe('interpolate', () => {
  const state = withGenerator(withResource(freshState(), 'gold', '1500', '2.5e9'), 'g1', 42);
  const reborn = { ...state, prestige: { ...state.prestige, count: 3 } };

  it('leaves plain text alone', () => {
    expect(interpolate('The world went out.', state, config)).toBe('The world went out.');
    expect(interpolate('', state, config)).toBe('');
  });

  it('substitutes the rebirth count', () => {
    expect(interpolate('Run {rebirthCount}.', reborn, config)).toBe('Run 3.');
    expect(interpolate('Run {rebirthCount}.', state, config)).toBe('Run 0.');
  });

  it('formats resource values rather than dumping raw numbers', () => {
    expect(interpolate('{resource:gold}', state, config)).toBe('1,500');
    expect(interpolate('{lifetime:gold}', state, config)).toBe('2.50 B');
    expect(interpolate('{run:gold}', state, config)).toBe('2.50 B');
  });

  it('formats generator counts as whole numbers', () => {
    expect(interpolate('{owned:g1}', state, config)).toBe('42');
  });

  it('reads the shard balance', () => {
    const shards = withResource(state, 'meta', '12');
    expect(interpolate('{shards}', shards, config)).toBe('12');
  });

  it('substitutes several tokens in one string', () => {
    expect(
      interpolate('Run {rebirthCount}: {lifetime:gold} gold, {owned:g1} units.', reborn, config),
    ).toBe('Run 3: 2.50 B gold, 42 units.');
  });

  it('makes the same template read differently across rebirths', () => {
    const template = 'This is valley {rebirthCount}.';
    expect(interpolate(template, state, config)).not.toBe(interpolate(template, reborn, config));
  });

  it('leaves unknown tokens visible instead of blanking the sentence', () => {
    expect(interpolate('Hello {nonsense}.', state, config)).toBe('Hello {nonsense}.');
    expect(interpolate('Hello {resource}.', state, config)).toBe('Hello {resource}.');
  });

  it('renders zero for ids that are not in this save', () => {
    expect(interpolate('{resource:ghost}', state, config)).toBe('0.00');
    expect(interpolate('{owned:ghost}', state, config)).toBe('0');
  });

  it('is pure — the same inputs always give the same output', () => {
    const template = '{rebirthCount}/{resource:gold}/{owned:g1}';
    expect(interpolate(template, state, config)).toBe(interpolate(template, state, config));
  });
});
