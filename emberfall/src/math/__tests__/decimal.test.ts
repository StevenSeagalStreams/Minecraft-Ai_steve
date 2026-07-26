import {
  D,
  Decimal,
  ONE,
  ZERO,
  clampD,
  deserializeDecimal,
  isValid,
  isZero,
  logBase,
  maxD,
  minD,
  productD,
  serializeDecimal,
  sumD,
} from '../decimal';

describe('D', () => {
  it('passes through existing Decimals without copying', () => {
    const value = new Decimal('1e20');
    expect(D(value)).toBe(value);
  });

  it('accepts numbers and strings', () => {
    expect(D(5).eq(5)).toBe(true);
    expect(D('1.5e30').eq(new Decimal('1.5e30'))).toBe(true);
  });

  it('coerces invalid input to zero rather than propagating NaN', () => {
    expect(isZero(D(Number.NaN))).toBe(true);
    expect(isZero(D('not a number'))).toBe(true);
  });
});

describe('comparison helpers', () => {
  it('picks minima and maxima', () => {
    expect(maxD(D(3), D(7)).eq(7)).toBe(true);
    expect(minD(D(3), D(7)).eq(3)).toBe(true);
  });

  it('clamps into range', () => {
    expect(clampD(D(11), ZERO, D(10)).eq(10)).toBe(true);
    expect(clampD(D(-1), ZERO, D(10)).eq(0)).toBe(true);
    expect(clampD(D(5), ZERO, D(10)).eq(5)).toBe(true);
  });
});

describe('aggregation helpers', () => {
  it('sums to zero for an empty list', () => {
    expect(sumD([]).eq(ZERO)).toBe(true);
  });

  it('multiplies to one for an empty list', () => {
    expect(productD([]).eq(ONE)).toBe(true);
  });

  it('handles values far past Number.MAX_VALUE', () => {
    const huge = D('1e308');
    expect(sumD([huge, huge]).eq(D('2e308'))).toBe(true);
    expect(productD([huge, huge]).eq(D('1e616'))).toBe(true);
  });
});

describe('serialisation', () => {
  it('round-trips exactly', () => {
    for (const raw of ['0', '1', '-42', '1.23e45', '9.87e-12', '1e1000']) {
      const value = D(raw);
      const revived = deserializeDecimal(serializeDecimal(value));
      expect(revived.eq(value)).toBe(true);
    }
  });

  it('survives a JSON round-trip when values are stringified first', () => {
    const original = { amount: serializeDecimal(D('4.56e78')) };
    const parsed = JSON.parse(JSON.stringify(original)) as { amount: string };
    expect(deserializeDecimal(parsed.amount).eq(D('4.56e78'))).toBe(true);
  });

  it('falls back when the stored value is not a number', () => {
    expect(deserializeDecimal(undefined).eq(ZERO)).toBe(true);
    expect(deserializeDecimal(null, 7).eq(D(7))).toBe(true);
    expect(deserializeDecimal({}, '1e5').eq(D('1e5'))).toBe(true);
  });

  it('never serialises a non-finite value', () => {
    expect(serializeDecimal(new Decimal(Number.NaN))).toBe('0');
    expect(isValid(new Decimal(Number.NaN))).toBe(false);
  });
});

describe('logBase', () => {
  it('inverts exponentiation', () => {
    expect(logBase(D(1024), D(2))).toBeCloseTo(10, 6);
    expect(logBase(D('1e30'), D(10))).toBeCloseTo(30, 6);
  });

  it('returns 0 for degenerate input', () => {
    expect(logBase(D(0), D(2))).toBe(0);
    expect(logBase(D(10), ONE)).toBe(0);
  });
});
