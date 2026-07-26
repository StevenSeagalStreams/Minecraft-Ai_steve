import { FORMATTING } from '../../data/config';
import type { FormattingConfigDef } from '../../types/defs';
import { D } from '../decimal';
import {
  formatDecimal,
  formatDuration,
  formatMultiplier,
  formatPercent,
  formatRate,
  formatWhole,
  suffixForTier,
  timeToReach,
} from '../format';

const config = FORMATTING;

const withNotation = (notation: FormattingConfigDef['notation']): FormattingConfigDef => ({
  ...config,
  notation,
});

describe('suffixForTier', () => {
  it('names the small tiers', () => {
    expect(suffixForTier(0)).toBe('');
    expect(suffixForTier(1)).toBe('k');
    expect(suffixForTier(2)).toBe('M');
    expect(suffixForTier(4)).toBe('T');
    expect(suffixForTier(10)).toBe('No');
  });

  it('composes tiers from 1e33 upwards', () => {
    expect(suffixForTier(11)).toBe('Dc');
    expect(suffixForTier(12)).toBe('UDc');
    expect(suffixForTier(15)).toBe('QaDc');
    expect(suffixForTier(21)).toBe('Vg');
  });

  it('gives up past the naming table', () => {
    expect(suffixForTier(1000)).toBeNull();
  });
});

describe('formatDecimal', () => {
  it('prints small numbers plainly', () => {
    expect(formatDecimal(0, config)).toBe('0.00');
    expect(formatDecimal(7.5, config)).toBe('7.50');
    expect(formatDecimal(1234, config)).toBe('1,234');
  });

  it('uses suffixes above the plain threshold', () => {
    expect(formatDecimal(1_500_000, config)).toBe('1.50 M');
    expect(formatDecimal(D('1.23e45'), config)).toBe('1.23 QaDc');
  });

  it('handles the exact spec example', () => {
    expect(formatDecimal(D('1.23e45'), config)).toBe('1.23 QaDc');
  });

  it('keeps negatives signed', () => {
    expect(formatDecimal(D('-2.5e9'), config)).toBe('-2.50 B');
  });

  it('supports scientific and engineering notation', () => {
    expect(formatDecimal(D('1.23e45'), withNotation('scientific'))).toBe('1.23e45');
    expect(formatDecimal(D('1.23e46'), withNotation('engineering'))).toBe('12.30e45');
  });

  it('falls back to scientific beyond the naming table', () => {
    expect(formatDecimal(D('1e9000'), config)).toBe('1.00e9000');
  });

  it('never emits NaN', () => {
    expect(formatDecimal(D(Number.NaN), config)).toBe('0.00');
  });
});

describe('formatWhole', () => {
  it('drops the fractional part for counts', () => {
    expect(formatWhole(12.9, config)).toBe('12');
    expect(formatWhole(1_000_000, config)).toBe('1.00 M');
  });
});

describe('helpers', () => {
  it('formats rates and multipliers', () => {
    expect(formatRate(10, config)).toBe('10/s');
    expect(formatMultiplier(2.5, config)).toBe('×2.50');
    expect(formatPercent(0.25)).toBe('25%');
  });

  it('formats durations coarsely', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(8_100_000)).toBe('2h 15m');
    expect(formatDuration(90_061_000)).toBe('1d 1h');
  });

  it('computes time to reach a target', () => {
    expect(timeToReach(D(0), D(100), D(10))).toBe(10);
    expect(timeToReach(D(100), D(50), D(10))).toBe(0);
    expect(timeToReach(D(0), D(100), D(0))).toBeNull();
  });
});
