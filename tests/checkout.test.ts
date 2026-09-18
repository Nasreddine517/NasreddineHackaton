import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { migrate } from '../packages/core/src/db/migrate.js';
import { seed } from '../packages/core/src/db/seed.js';
import {
  confirmCheckout,
  prepareCheckout,
  setCartItem,
  getCart,
} from '../packages/core/src/domain/checkout.js';
import { BusinessError } from '../packages/core/src/domain/pricing.js';

const delivery = {
  city: 'Casablanca',
  address: '12 rue de démonstration',
  method: 'delivery',
  payment: 'cash_on_delivery',
};
const now = new Date('2026-09-18T12:00:00Z');
const code = (expected: string) => (e: unknown) =>
  e instanceof BusinessError && e.code === expected;

test('checkout revalidates prices, ownership, quantities and explicit confirmation', async () => {
  const engine = new PGlite();
  const connection = {
    async query(sql: string, args?: unknown[]) {
      if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
      return args ? engine.query(sql, args) : ((await engine.exec(sql)).at(-1) ?? { rows: [] });
    },
    release() {},
  };
  const pool = { ...connection, connect: async () => connection } as unknown as pg.Pool;
  try {
    await migrate(pool);
    await seed(pool);
    const [a, b] = (await pool.query('SELECT id FROM customers ORDER BY id LIMIT 2')).rows.map(
      (r) => r.id as string,
    );
    const customer = a!;
    await pool.query("UPDATE products SET stock=10 WHERE ref='REF-0001'");
    await setCartItem(pool, customer, { ref: 'REF-0001', quantity: 2 });
    await assert.rejects(
      () => setCartItem(pool, customer, { ref: 'REF-0001', quantity: 11 }),
      code('OUT_OF_STOCK'),
    );
    await assert.rejects(() =>
      setCartItem(pool, customer, { ref: 'REF-0001', quantity: 1, discountPercent: 10 }),
    );
    const quote = await prepareCheckout(pool, customer, delivery, now);
    assert.equal(quote.totalCentimes, 22500);
    await assert.rejects(
      () => confirmCheckout(pool, b!, { quoteId: quote.id, confirmed: true }, now),
      code('QUOTE_NOT_FOUND'),
    );
    await assert.rejects(() =>
      confirmCheckout(pool, customer, { quoteId: quote.id, confirmed: false }, now),
    );
    await pool.query("UPDATE products SET price_centimes=11000 WHERE ref='REF-0001'");
    await assert.rejects(
      () => confirmCheckout(pool, customer, { quoteId: quote.id, confirmed: true }, now),
      code('PRICE_CHANGED'),
    );
    assert.equal(
      (await pool.query("SELECT stock FROM products WHERE ref='REF-0001'")).rows[0].stock,
      10,
    );
    const fresh = await prepareCheckout(pool, customer, delivery, now);
    const order = await confirmCheckout(
      pool,
      customer,
      { quoteId: fresh.id, confirmed: true },
      now,
    );
    const retry = await confirmCheckout(
      pool,
      customer,
      { quoteId: fresh.id, confirmed: true },
      new Date('2026-09-19'),
    );
    assert.equal(retry.orderId, order.orderId);
    assert.equal(retry.alreadyConfirmed, true);
    assert.equal(
      (await pool.query("SELECT stock FROM products WHERE ref='REF-0001'")).rows[0].stock,
      8,
    );
    assert.equal((await getCart(pool, customer)).length, 0);
    const stored = (await pool.query('SELECT * FROM orders WHERE id=$1', [order.orderId])).rows[0];
    assert.equal(stored.total_centimes, 24500);
    assert.equal(stored.source, 'kenza');
    await setCartItem(pool, customer, { ref: 'REF-0001', quantity: 1 });
    const changed = await prepareCheckout(pool, customer, delivery, now);
    await setCartItem(pool, customer, { ref: 'REF-0001', quantity: 2 });
    await assert.rejects(
      () => confirmCheckout(pool, customer, { quoteId: changed.id, confirmed: true }, now),
      code('CART_CHANGED'),
    );
    const expired = await prepareCheckout(pool, customer, delivery, now);
    await assert.rejects(
      () =>
        confirmCheckout(
          pool,
          customer,
          { quoteId: expired.id, confirmed: true },
          new Date(now.getTime() + 600_000),
        ),
      code('QUOTE_EXPIRED'),
    );
    await pool.query("UPDATE products SET stock=0 WHERE ref='REF-0001'");
    await assert.rejects(
      () => confirmCheckout(pool, customer, { quoteId: expired.id, confirmed: true }, now),
      code('OUT_OF_STOCK'),
    );
    await pool.query("UPDATE products SET stock=10 WHERE ref='REF-0001'");
    await setCartItem(pool, customer, { ref: 'REF-0001', quantity: 0 });
    await pool.query("UPDATE products SET stock=10 WHERE ref='REF-0074'");
    await setCartItem(pool, customer, { ref: 'REF-0074', quantity: 1 });
    const promo = await prepareCheckout(pool, customer, delivery, now);
    assert.equal(promo.lines[0]?.source, 'promotion');
    assert.equal(promo.lines[0]?.unitCentimes, 24000);
    await assert.rejects(
      () => prepareCheckout(pool, customer, { ...delivery, city: 'Fès' }, now),
      code('COD_UNAVAILABLE'),
    );
    await assert.rejects(
      () => prepareCheckout(pool, customer, { ...delivery, city: 'Paris' }, now),
      code('CITY_REQUIRES_HUMAN'),
    );
    const pickup = await prepareCheckout(
      pool,
      customer,
      { city: 'Fès', method: 'pickup', payment: 'bank_transfer' },
      now,
    );
    assert.equal(pickup.delivery.feeCentimes, 0);
    assert.equal(pickup.delivery.delayHours, 24);
  } finally {
    await engine.close();
  }
});

// Opt in with TEST_DATABASE_URL. All writes are confined to a unique, disposable schema.
test(
  'PostgreSQL: concurrent last-item purchase and duplicate confirmation',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const schema = `test_checkout_${randomUUID().replaceAll('-', '')}`;
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const pool = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${schema}`,
      max: 5,
    });
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await migrate(pool);
      await seed(pool);
      const customers = (await pool.query('SELECT id FROM customers ORDER BY id LIMIT 3')).rows.map(
        (r) => r.id as string,
      );
      await pool.query("UPDATE products SET stock=1 WHERE ref='REF-0001'");
      const quotes = [];
      for (const id of customers.slice(0, 2)) {
        await setCartItem(pool, id, { ref: 'REF-0001', quantity: 1 });
        quotes.push(await prepareCheckout(pool, id, delivery, now));
      }
      const competing = await Promise.allSettled(
        quotes.map((q, i) =>
          confirmCheckout(pool, customers[i]!, { quoteId: q.id, confirmed: true }, now),
        ),
      );
      assert.equal(competing.filter((r) => r.status === 'fulfilled').length, 1);
      const failed = competing.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      assert.equal(failed.reason.code, 'OUT_OF_STOCK');
      assert.equal(
        (await pool.query("SELECT stock FROM products WHERE ref='REF-0001'")).rows[0].stock,
        0,
      );
      await pool.query("UPDATE products SET stock=3 WHERE ref='REF-0002'");
      await setCartItem(pool, customers[2]!, { ref: 'REF-0002', quantity: 1 });
      const quote = await prepareCheckout(pool, customers[2]!, delivery, now);
      const repeated = await Promise.all(
        Array.from({ length: 4 }, () =>
          confirmCheckout(pool, customers[2]!, { quoteId: quote.id, confirmed: true }, now),
        ),
      );
      assert.equal(new Set(repeated.map((r) => r.orderId)).size, 1);
      assert.equal(repeated.filter((r) => !r.alreadyConfirmed).length, 1);
      assert.equal(
        (await pool.query("SELECT stock FROM products WHERE ref='REF-0002'")).rows[0].stock,
        2,
      );
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  },
);
