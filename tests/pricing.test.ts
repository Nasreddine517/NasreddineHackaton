import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BusinessError,
  madToCentimes,
  moroccoDate,
  quoteUnitPrice,
} from '../packages/core/src/domain/pricing.js';

const now = new Date('2026-09-17T12:00:00Z');
const base = { baseCentimes: 20000, stock: 2, now };
test('money is exact in centimes, rejecting unsupported and negative amounts', () => {
  assert.equal(madToCentimes('10.01'), 1001);
  for (const invalid of ['-1', 'NaN', '1.001', '1e3', '', '99999999999999'])
    assert.throws(() => madToCentimes(invalid));
});
test('10% floor cannot be crossed, even by rounding or invalid discounts', () => {
  assert.equal(quoteUnitPrice({ ...base, discountPercent: 10 }).unitCentimes, 18000);
  assert.equal(
    quoteUnitPrice({ ...base, baseCentimes: 101, discountPercent: 10 }).unitCentimes,
    91,
  );
  for (const discountPercent of [11, 100, -1, NaN, Infinity]) {
    assert.throws(
      () => quoteUnitPrice({ ...base, discountPercent }),
      (e: unknown) => e instanceof BusinessError && e.code === 'DISCOUNT_REQUIRES_HUMAN',
    );
  }
});
test('promotion is preferred with no stacking, including on its last day', () => {
  const promotion = {
    priceCentimes: 15000,
    startsOn: '2026-09-01',
    endsOn: '2026-09-17',
    condition: 'dans la limite des stocks disponibles',
  };
  assert.deepEqual(quoteUnitPrice({ ...base, promotion, discountPercent: 10 }), {
    unitCentimes: 15000,
    source: 'promotion',
    discountPercent: 0,
  });
  assert.equal(
    quoteUnitPrice({
      ...base,
      promotion,
      now: new Date('2026-09-18T12:00:00Z'),
      discountPercent: 10,
    }).unitCentimes,
    18000,
  );
});
test('unknown promotion conditions and unavailable stock cannot be sold', () => {
  assert.throws(
    () => quoteUnitPrice({ ...base, stock: 0 }),
    (e: unknown) => e instanceof BusinessError && e.code === 'OUT_OF_STOCK',
  );
  assert.throws(() =>
    quoteUnitPrice({
      ...base,
      promotion: {
        priceCentimes: 15000,
        startsOn: '2026-09-01',
        endsOn: '2026-09-30',
        condition: 'sur validation',
      },
    }),
  );
});
test('promotion dates use Morocco business date, not the machine timezone', () => {
  assert.equal(moroccoDate(new Date('2026-09-17T23:30:00Z')), '2026-09-18');
});
