import type { CostCurveDef } from '../../types/defs';
import { D, ONE, ZERO } from '../decimal';
import { bonusMultiplier, bulkCost, maxAffordable, repeatedFactor, softcap, unitCost } from '../scaling';

const exponential: CostCurveDef = {
  kind: 'exponential',
  resource: 'ember',
  base: '10',
  growth: '1.5',
};

const linear: CostCurveDef = { kind: 'linear', resource: 'ember', base: '10', step: '5' };

const polynomial: CostCurveDef = {
  kind: 'polynomial',
  resource: 'ember',
  base: '10',
  exponent: 2,
};

describe('unitCost', () => {
  it('scales exponentially with the number owned', () => {
    expect(unitCost(exponential, ZERO).eq(10)).toBe(true);
    expect(unitCost(exponential, D(1)).eq(15)).toBe(true);
    expect(unitCost(exponential, D(2)).eq(22.5)).toBe(true);
  });

  it('scales linearly and polynomially', () => {
    expect(unitCost(linear, D(3)).eq(25)).toBe(true);
    expect(unitCost(polynomial, D(2)).eq(90)).toBe(true);
  });

  it('stays exact deep into the exponential range', () => {
    const owned = D(500);
    const expected = D('10').mul(D('1.5').pow(owned));
    expect(unitCost(exponential, owned).eq(expected)).toBe(true);
  });
});

describe('bulkCost', () => {
  it('matches the term-by-term sum for exponential curves', () => {
    const owned = D(7);
    const count = 12;
    let manual = ZERO;
    for (let index = 0; index < count; index += 1) {
      manual = manual.add(unitCost(exponential, owned.add(index)));
    }
    const closedForm = bulkCost(exponential, owned, D(count));
    expect(closedForm.sub(manual).abs().lt(manual.mul('1e-9'))).toBe(true);
  });

  it('matches the term-by-term sum for linear curves', () => {
    let manual = ZERO;
    for (let index = 0; index < 6; index += 1) {
      manual = manual.add(unitCost(linear, D(2).add(index)));
    }
    expect(bulkCost(linear, D(2), D(6)).eq(manual)).toBe(true);
  });

  it('returns zero for non-positive counts', () => {
    expect(bulkCost(exponential, ZERO, ZERO).eq(ZERO)).toBe(true);
    expect(bulkCost(exponential, ZERO, D(-5)).eq(ZERO)).toBe(true);
  });

  it('handles a growth factor of exactly 1', () => {
    const flat: CostCurveDef = { kind: 'exponential', resource: 'ember', base: '10', growth: '1' };
    expect(bulkCost(flat, D(99), D(4)).eq(40)).toBe(true);
  });

  it('is cheap for enormous counts', () => {
    const total = bulkCost(exponential, ZERO, D('1e6'));
    expect(total.gt(D('1e100'))).toBe(true);
  });
});

describe('maxAffordable', () => {
  it('buys nothing when the first unit is out of reach', () => {
    expect(maxAffordable(exponential, ZERO, D(9)).eq(ZERO)).toBe(true);
    expect(maxAffordable(exponential, ZERO, ZERO).eq(ZERO)).toBe(true);
  });

  it('is the exact inverse of bulkCost for exponential curves', () => {
    for (const owned of [0, 5, 40]) {
      for (const budget of ['100', '1e6', '1e18']) {
        const count = maxAffordable(exponential, D(owned), D(budget));
        expect(bulkCost(exponential, D(owned), count).lte(D(budget))).toBe(true);
        expect(bulkCost(exponential, D(owned), count.add(ONE)).gt(D(budget))).toBe(true);
      }
    }
  });

  it('inverts non-exponential curves by search', () => {
    const count = maxAffordable(linear, ZERO, D(100));
    expect(bulkCost(linear, ZERO, count).lte(100)).toBe(true);
    expect(bulkCost(linear, ZERO, count.add(ONE)).gt(100)).toBe(true);
  });
});

describe('softcap', () => {
  it('leaves values below the threshold untouched', () => {
    expect(softcap(D(50), D(100), 0.5).eq(50)).toBe(true);
  });

  it('compresses only the excess', () => {
    const capped = softcap(D(10_000), D(100), 0.5);
    expect(capped.eq(1_000)).toBe(true);
    expect(capped.lt(10_000)).toBe(true);
  });

  it('is a no-op for exponents at or above 1', () => {
    expect(softcap(D(10_000), D(100), 1).eq(10_000)).toBe(true);
  });
});

describe('bonusMultiplier', () => {
  it('is 1 with no count', () => {
    expect(bonusMultiplier(ZERO, D('0.5'), 0.9).eq(ONE)).toBe(true);
  });

  it('grows sub-linearly with the exponent', () => {
    const ten = bonusMultiplier(D(10), D('0.5'), 0.9);
    const hundred = bonusMultiplier(D(100), D('0.5'), 0.9);
    expect(hundred.gt(ten)).toBe(true);
    expect(hundred.lt(ONE.add(D('0.5').mul(100)))).toBe(true);
  });
});

describe('repeatedFactor', () => {
  it('is the identity at level 0 or below', () => {
    expect(repeatedFactor(D(2), 0).eq(ONE)).toBe(true);
    expect(repeatedFactor(D(2), -3).eq(ONE)).toBe(true);
  });

  it('compounds per level', () => {
    expect(repeatedFactor(D(2), 10).eq(1024)).toBe(true);
  });
});
