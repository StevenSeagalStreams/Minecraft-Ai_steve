import {
  COMPOSED_SUFFIX_START_TIER,
  DURATION_UNITS,
  HUNDREDS_FRAGMENTS,
  MAX_NAMED_TIER,
  ONES_FRAGMENTS,
  SMALL_SUFFIXES,
  TENS_FRAGMENTS,
} from '../data/notation';
import type { FormattingConfigDef } from '../types/defs';
import { D, type Decimal, type DecimalSource, isValid } from './decimal';

const DIGITS_PER_TIER = 3;

/**
 * Suffix for a magnitude tier, where tier 1 is 1e3.
 * Returns `null` when the tier is past the naming table.
 */
export function suffixForTier(tier: number): string | null {
  if (tier <= 0) return '';
  if (tier <= SMALL_SUFFIXES.length) return SMALL_SUFFIXES[tier - 1] ?? null;
  if (tier >= MAX_NAMED_TIER) return null;

  const index = tier - 1;
  const ones = ONES_FRAGMENTS[index % 10] ?? '';
  const tens = TENS_FRAGMENTS[Math.floor(index / 10) % 10] ?? '';
  const hundreds = HUNDREDS_FRAGMENTS[Math.floor(index / 100) % 10] ?? '';
  return `${ones}${tens}${hundreds}`;
}

function groupInteger(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

function formatPlain(value: Decimal, config: FormattingConfigDef): string {
  const asNumber = value.toNumber();
  const magnitude = Math.abs(asNumber);
  const places = magnitude < 10 ? config.smallDecimalPlaces : 0;
  const fixed = asNumber.toFixed(places);
  const [integerPart = '0', fractionPart] = fixed.split('.');
  const sign = integerPart.startsWith('-') ? '-' : '';
  const grouped = groupInteger(sign ? integerPart.slice(1) : integerPart, config.groupSeparator);
  const withFraction = fractionPart !== undefined ? `${grouped}.${fractionPart}` : grouped;
  return `${sign}${withFraction}`;
}

function splitTier(value: Decimal): { tier: number; mantissa: number } {
  const tier = Math.floor(value.exponent / DIGITS_PER_TIER);
  const mantissa = value.mantissa * 10 ** (value.exponent - tier * DIGITS_PER_TIER);
  return { tier, mantissa };
}

function formatScientific(value: Decimal, config: FormattingConfigDef): string {
  const sign = value.sign() < 0 ? '-' : '';
  const mantissa = Math.abs(value.mantissa).toFixed(config.decimalPlaces);
  return `${sign}${mantissa}e${value.exponent}`;
}

function formatEngineering(value: Decimal, config: FormattingConfigDef): string {
  const { tier, mantissa } = splitTier(value);
  const sign = mantissa < 0 ? '-' : '';
  return `${sign}${Math.abs(mantissa).toFixed(config.decimalPlaces)}e${tier * DIGITS_PER_TIER}`;
}

function formatStandard(value: Decimal, config: FormattingConfigDef): string {
  const { tier, mantissa } = splitTier(value);
  const suffix = suffixForTier(tier);
  if (suffix === null) return formatScientific(value, config);
  const sign = mantissa < 0 ? '-' : '';
  const digits = Math.abs(mantissa).toFixed(config.decimalPlaces);
  return `${sign}${digits}${config.suffixSeparator}${suffix}`;
}

/**
 * Primary number formatter. Small magnitudes print plainly; everything above
 * `plainBelow` uses the configured notation (`1.23e45` → `"1.23 QaDc"`).
 */
export function formatDecimal(source: DecimalSource, config: FormattingConfigDef): string {
  const value = D(source);
  if (!isValid(value)) return '—';
  if (value.abs().lt(D(config.plainBelow))) return formatPlain(value, config);

  switch (config.notation) {
    case 'scientific':
      return formatScientific(value, config);
    case 'engineering':
      return formatEngineering(value, config);
    case 'standard':
      return formatStandard(value, config);
    default:
      return formatStandard(value, config);
  }
}

/** Counts (generators owned) never want a fractional part. */
export function formatWhole(source: DecimalSource, config: FormattingConfigDef): string {
  const value = D(source).floor();
  if (value.abs().lt(D(config.plainBelow))) {
    return groupInteger(value.toNumber().toFixed(0), config.groupSeparator);
  }
  return formatDecimal(value, config);
}

export function formatRate(source: DecimalSource, config: FormattingConfigDef): string {
  return `${formatDecimal(source, config)}/s`;
}

export function formatMultiplier(source: DecimalSource, config: FormattingConfigDef): string {
  return `×${formatDecimal(source, config)}`;
}

export function formatPercent(fraction: number, decimals = 0): string {
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/** `"2h 15m"` — coarse, two most significant units, for offline summaries. */
export function formatDuration(ms: number, maxUnits = 2): string {
  if (!Number.isFinite(ms) || ms < 1000) return '0s';
  const parts: string[] = [];
  let remaining = Math.floor(ms);
  for (const unit of DURATION_UNITS) {
    if (parts.length >= maxUnits) break;
    const count = Math.floor(remaining / unit.ms);
    if (count > 0 || parts.length > 0) {
      if (count > 0) parts.push(`${count}${unit.label}`);
      remaining -= count * unit.ms;
    }
  }
  return parts.length > 0 ? parts.join(' ') : '0s';
}

/** Seconds until `target` is reachable at `rate`; `null` when unreachable. */
export function timeToReach(current: Decimal, target: Decimal, rate: Decimal): number | null {
  if (current.gte(target)) return 0;
  if (rate.lte(0)) return null;
  const seconds = target.sub(current).div(rate).toNumber();
  return Number.isFinite(seconds) ? seconds : null;
}
