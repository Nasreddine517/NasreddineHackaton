import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { migrate } from '../packages/core/src/db/migrate.js';
import { seed } from '../packages/core/src/db/seed.js';
import { quoteDelivery, searchProducts } from '../packages/core/src/domain/catalogue.js';
import { BusinessError } from '../packages/core/src/domain/pricing.js';

test('SQL migrations, reproducible import, constraints and catalogue tools (embedded PostgreSQL)', async (t) => {
  const engine = new PGlite();
  // PGlite executes real PostgreSQL SQL but has one connection: the advisory lock
  // concurrency guarantee must additionally be tested on PostgreSQL 16 in Docker.
  const connection = {
    async query(sql: string, args?: unknown[]) {
      if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
      if (args) return engine.query(sql, args);
      return (await engine.exec(sql)).at(-1) ?? { rows: [] };
    },
    release() {},
  };
  const pool = { ...connection, connect: async () => connection } as unknown as pg.Pool;
  try {
    await migrate(pool);
    await migrate(pool);
    assert.equal((await seed(pool)).imported, true);

    await t.test('import preserves live stock on second startup', async () => {
      await pool.query("UPDATE products SET stock = 1 WHERE ref = 'REF-0001'");
      assert.equal((await seed(pool)).imported, false);
      assert.equal(
        (await pool.query("SELECT stock FROM products WHERE ref = 'REF-0001'")).rows[0].stock,
        1,
      );
      assert.equal(Number((await pool.query('SELECT count(*) AS n FROM orders')).rows[0].n), 320);
      assert.equal(
        Number((await pool.query('SELECT count(*) AS n FROM order_lines')).rows[0].n),
        449,
      );
    });
    await t.test('database refuses negative stock and invalid totals', async () => {
      await assert.rejects(() =>
        pool.query("UPDATE products SET stock = -1 WHERE ref = 'REF-0001'"),
      );
      await assert.rejects(() =>
        pool.query("UPDATE orders SET total_centimes = 1 WHERE id = 'CMD-00001'"),
      );
    });
    await t.test(
      'catalogue tools use actual stock and dated promotions without exposing restock estimates',
      async () => {
        const products = await searchProducts(
          pool,
          { query: 'REF-0001' },
          new Date('2026-09-17T12:00:00Z'),
        );
        assert.equal(products.length, 1);
        assert.equal(products[0]?.stock, 1);
        assert.equal(products[0]?.priceCentimes, 10000);
        assert.equal('restock_days_internal' in products[0]!, false);
        assert.equal(
          (await searchProducts(pool, { query: "'; DROP TABLE products; --" })).length,
          0,
        );
        assert.equal((await searchProducts(pool, { query: '%' })).length, 0);
        const blue = await searchProducts(pool, {
          query: 'foulard',
          color: 'bleu',
          material: 'coton',
          maxPriceCentimes: 20000,
        });
        assert.ok(blue.some((p) => p.ref === 'REF-0006'));
        assert.equal(
          (await searchProducts(pool, { query: 'foulard', color: 'bleu', maxPriceCentimes: 100 }))
            .length,
          0,
        );
        const promotional = await searchProducts(
          pool,
          { query: 'REF-0074', availableOnly: false },
          new Date('2026-09-17T12:00:00Z'),
        );
        assert.equal(promotional[0]?.promotion?.priceCentimes, 24000);
        const expired = await searchProducts(
          pool,
          { query: 'REF-0074', availableOnly: false },
          new Date('2026-10-01T12:00:00Z'),
        );
        assert.equal(expired[0]?.promotion, null);
      },
    );
    await t.test(
      'delivery uses supplied fees and COD permissions; unknown city escalates',
      async () => {
        assert.deepEqual(await quoteDelivery(pool, 'Casa', 'delivery', true), {
          city: 'Casablanca',
          feeCentimes: 2500,
          delayHours: 72,
          method: 'delivery',
          cashOnDelivery: true,
        });
        assert.equal((await quoteDelivery(pool, ' Fes ', 'delivery', false)).feeCentimes, 3500);
        await assert.rejects(
          () => quoteDelivery(pool, 'Fès', 'delivery', true),
          (e: unknown) => e instanceof BusinessError && e.code === 'COD_UNAVAILABLE',
        );
        await assert.rejects(
          () => quoteDelivery(pool, 'Paris', 'delivery', false),
          (e: unknown) => e instanceof BusinessError && e.code === 'CITY_REQUIRES_HUMAN',
        );
        assert.equal((await quoteDelivery(pool, 'Fès', 'pickup', false)).feeCentimes, 0);
      },
    );
  } finally {
    await engine.close();
  }
});
