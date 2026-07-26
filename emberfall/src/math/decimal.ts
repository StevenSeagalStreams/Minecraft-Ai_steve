import Decimal from 'break_infinity.js';

export { Decimal };

export type DecimalSource = Decimal | number | string;

/**
 * Shared constants. `break_infinity` operations always return new instances,
 * so these are safe to share as long as nothing assigns to `.mantissa`/
 * `.exponent` — which nothing in this codebase does.
 */
export const ZERO: Decimal = new Decimal(0);
export const ONE: Decimal = new Decimal(1);
export const TEN: Decimal = new Decimal(10);

/**
 * Parses without throwing. `break_infinity` raises `DecimalError` on strings it
 * cannot read (`"banana"`) and yields `NaN` for others, so both failure modes
 * are funnelled into a single `null` result.
 */
function tryParse(value: string | number): Decimal | null {
  try {
    const decimal = new Decimal(value);
    return isValid(decimal) ? decimal : null;
  } catch {
    return null;
  }
}

/**
 * Canonical coercion. Cheap for values that are already `Decimal`, and total:
 * anything unparseable becomes zero rather than an exception or a `NaN` that
 * would spread silently through the save.
 */
export function D(value: DecimalSource): Decimal {
  if (value instanceof Decimal) return value;
  return tryParse(value) ?? new Decimal(0);
}

/** Guards against `NaN`/`Infinity` leaking into saves or the UI. */
export function isValid(value: Decimal): boolean {
  return Number.isFinite(value.mantissa) && Number.isFinite(value.exponent);
}

export function isZero(value: Decimal): boolean {
  return value.mantissa === 0;
}

export function isPositive(value: Decimal): boolean {
  return value.gt(ZERO);
}

export function maxD(a: Decimal, b: Decimal): Decimal {
  return a.gte(b) ? a : b;
}

export function minD(a: Decimal, b: Decimal): Decimal {
  return a.lte(b) ? a : b;
}

export function clampD(value: Decimal, low: Decimal, high: Decimal): Decimal {
  return minD(maxD(value, low), high);
}

/** Sum with a `Decimal`-safe identity; empty input yields zero, never `NaN`. */
export function sumD(values: readonly Decimal[]): Decimal {
  let total = ZERO;
  for (const value of values) total = total.add(value);
  return total;
}

export function productD(values: readonly Decimal[]): Decimal {
  let total = ONE;
  for (const value of values) total = total.mul(value);
  return total;
}

/**
 * Serialisation pair used by the persist layer. `toString()` round-trips
 * exactly for `break_infinity` values (`"1.23e45"`, `"0"`, `"-5"`).
 */
export function serializeDecimal(value: Decimal): string {
  return isValid(value) ? value.toString() : '0';
}

export function deserializeDecimal(value: unknown, fallback: DecimalSource = 0): Decimal {
  if (typeof value === 'string' || typeof value === 'number') {
    const decimal = tryParse(value);
    if (decimal !== null) return decimal;
  }
  return D(fallback);
}

/**
 * Largest integer `n` with `base ^ n <= value`. Used by bulk-buy inversion.
 * Returns 0 when the relation cannot hold.
 */
export function logBase(value: Decimal, base: Decimal): number {
  if (value.lte(ZERO) || base.lte(ONE)) return 0;
  const result = value.log10() / base.log10();
  return Number.isFinite(result) ? result : 0;
}
