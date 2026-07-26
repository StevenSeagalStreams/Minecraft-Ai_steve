import type { CostCurveDef } from '../types/defs';
import { D, type Decimal, ONE, ZERO, logBase, maxD } from './decimal';

/**
 * Price of the single purchase that takes you from `owned` to `owned + 1`.
 * All curves are pure functions of (definition, owned) — no state involved.
 */
export function unitCost(curve: CostCurveDef, owned: Decimal): Decimal {
  const base = D(curve.base);
  switch (curve.kind) {
    case 'exponential':
      return base.mul(D(curve.growth).pow(owned));
    case 'polynomial':
      return base.mul(owned.add(ONE).pow(curve.exponent));
    case 'linear':
      return base.add(D(curve.step).mul(owned));
    default:
      return base;
  }
}

/**
 * Total price of buying `count` units starting from `owned`.
 *
 * The exponential branch uses the closed-form geometric sum so that buying
 * 1e9 units costs one multiplication rather than a billion iterations.
 */
export function bulkCost(curve: CostCurveDef, owned: Decimal, count: Decimal): Decimal {
  if (count.lte(ZERO)) return ZERO;
  const base = D(curve.base);

  switch (curve.kind) {
    case 'exponential': {
      const growth = D(curve.growth);
      if (growth.eq(ONE)) return base.mul(count);
      const first = base.mul(growth.pow(owned));
      return first.mul(growth.pow(count).sub(ONE)).div(growth.sub(ONE));
    }
    case 'linear': {
      // Arithmetic series: count * first + step * count * (count - 1) / 2
      const step = D(curve.step);
      const first = base.add(step.mul(owned));
      return first.mul(count).add(step.mul(count).mul(count.sub(ONE)).div(2));
    }
    case 'polynomial': {
      // No cheap closed form; sum term by term with a hard iteration bound.
      let total = ZERO;
      const iterations = Math.min(count.toNumber(), POLYNOMIAL_SUM_LIMIT);
      for (let index = 0; index < iterations; index += 1) {
        total = total.add(unitCost(curve, owned.add(index)));
      }
      return total;
    }
    default:
      return ZERO;
  }
}

/** Guard rail for the polynomial bulk sum; well beyond any real bulk purchase. */
export const POLYNOMIAL_SUM_LIMIT = 10_000;

/**
 * How many units `budget` can buy, starting from `owned`.
 *
 * Exponential is inverted analytically:
 *   n = log_g( 1 + budget * (g - 1) / (base * g^owned) )
 * Other curves fall back to a bounded binary search, which stays exact for
 * integer counts and never loops more than ~log2(limit) times.
 */
export function maxAffordable(
  curve: CostCurveDef,
  owned: Decimal,
  budget: Decimal,
  limit = MAX_AFFORDABLE_LIMIT,
): Decimal {
  if (budget.lte(ZERO)) return ZERO;
  if (bulkCost(curve, owned, ONE).gt(budget)) return ZERO;

  if (curve.kind === 'exponential') {
    const growth = D(curve.growth);
    const base = D(curve.base);
    if (growth.eq(ONE)) return budget.div(base).floor();
    const first = base.mul(growth.pow(owned));
    const ratio = budget.mul(growth.sub(ONE)).div(first).add(ONE);
    const count = Math.floor(logBase(ratio, growth));
    return maxD(D(Number.isFinite(count) ? count : 0), ZERO);
  }

  let low = ONE;
  let high = D(limit);
  while (low.lt(high)) {
    const mid = low.add(high).div(2).floor().add(ONE);
    if (bulkCost(curve, owned, mid).lte(budget)) {
      low = mid;
    } else {
      high = mid.sub(ONE);
    }
  }
  return low;
}

export const MAX_AFFORDABLE_LIMIT = 1_000_000;

/**
 * Diminishing returns above a threshold: values below `threshold` pass through
 * untouched, above it only the excess is compressed by `exponent`.
 */
export function softcap(value: Decimal, threshold: Decimal, exponent: number): Decimal {
  if (value.lte(threshold) || exponent >= 1) return value;
  const excess = value.div(threshold);
  return threshold.mul(excess.pow(exponent));
}

/** `1 + coefficient * count ^ exponent` — the shape used for shard bonuses. */
export function bonusMultiplier(count: Decimal, coefficient: Decimal, exponent: number): Decimal {
  if (count.lte(ZERO)) return ONE;
  return ONE.add(coefficient.mul(count.pow(exponent)));
}

/** `factor ^ level`, guarding the level-0 case that `pow` would still handle. */
export function repeatedFactor(factor: Decimal, level: number): Decimal {
  if (level <= 0) return ONE;
  return factor.pow(level);
}
