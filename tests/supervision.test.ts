import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { migrate } from '../packages/core/src/db/migrate.js';
import { seed } from '../packages/core/src/db/seed.js';
import { createApp } from '../apps/api/src/app.js';
import { merchantMetrics, updateSupervision } from '../packages/core/src/domain/supervision.js';
import type { createConnections } from '../packages/core/src/connections.js';
import {
  confirmCheckout,
  prepareCheckout,
  setCartItem,
} from '../packages/core/src/domain/checkout.js';

test('supervision: real SQL metrics, protected routes, atomic handoff and duplicate merchant replies', async () => {
  const engine = new PGlite();
  let failAudit = false;
  const connection = {
    async query(sql: string, args?: unknown[]) {
      // Single-connection SQL coverage only. Lock concurrency is tested separately on PostgreSQL.
      if (sql.startsWith('SELECT pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (sql.startsWith('SELECT pg_advisory')) return { rows: [] };
      if (failAudit && sql.includes('INSERT INTO agent_events'))
        throw new Error('simulated audit failure');
      return args ? engine.query(sql, args) : ((await engine.exec(sql)).at(-1) ?? { rows: [] });
    },
    release() {},
  };
  const db = { ...connection, connect: async () => connection } as unknown as pg.Pool;
  const sessions = new Map<string, string>();
  const dependencies = {
    db,
    redis: {
      get: async (key: string) => sessions.get(key) ?? null,
      set: async (key: string, value: string) => {
        sessions.set(key, value);
      },
      del: async (key: string) => {
        sessions.delete(key);
      },
      eval: async () => 1,
    },
    close: async () => {},
  } as unknown as ReturnType<typeof createConnections>;
  const config = {
    MERCHANT_EMAIL: 'test@example.test',
    MERCHANT_PASSWORD: 'test-only-long-password',
    COOKIE_SECURE: false,
  };
  const app = await createApp(dependencies, 'silent', config);
  const headers = { 'x-kenza-request': '1' };
  try {
    await migrate(db);
    await seed(db);
    const empty = await merchantMetrics(db);
    assert.equal(empty.orders, 0);
    assert.equal(empty.sales_centimes, 0);
    assert.equal(empty.conversion_percent, null);
    for (const id of ['CLI-0001', 'CLI-0002']) {
      await db.query('INSERT INTO conversations(customer_id) VALUES ($1)', [id]);
      await db.query(
        "INSERT INTO chat_messages(customer_id,role,content) VALUES ($1,'user','Salam')",
        [id],
      );
    }
    const turn = randomUUID();
    await db.query(
      "INSERT INTO chat_turns(id,customer_id,input,status) VALUES ($1,'CLI-0001','Paris','completed')",
      [turn],
    );
    await db.query(
      "INSERT INTO escalations(id,customer_id,turn_id,reason,context) VALUES ($1,'CLI-0001',$2,'CITY_REQUIRES_HUMAN','{}')",
      [randomUUID(), turn],
    );
    for (const path of ['/metrics', '/conversations', '/conversations/CLI-0001', '/followups'])
      assert.equal((await app.inject(`/api/merchant${path}`)).statusCode, 401);
    const login = await app.inject({
      method: 'POST',
      url: '/api/merchant/login',
      headers,
      payload: { email: config.MERCHANT_EMAIL, password: config.MERCHANT_PASSWORD },
    });
    const merchant = { ...headers, cookie: String(login.headers['set-cookie']).split(';')[0]! };
    const client = await app.inject({
      method: 'POST',
      url: '/api/demo/session',
      headers,
      payload: { customerId: 'CLI-0001' },
    });
    assert.equal(
      (
        await app.inject({
          url: '/api/merchant/metrics',
          headers: { cookie: String(client.headers['set-cookie']).split(';')[0]! },
        })
      ).statusCode,
      401,
    );
    const post = (path: string, payload: unknown) =>
      app.inject({
        method: 'POST',
        url: `/api/merchant/conversations/${path}`,
        headers: merchant,
        payload: payload as Record<string, unknown>,
      });
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/merchant/conversations/CLI-0001/control',
          headers: { cookie: merchant.cookie },
          payload: { mode: 'human' },
        })
      ).statusCode,
      403,
    );
    assert.equal((await post('unknown/control', { mode: 'human' })).statusCode, 404);
    assert.equal((await post('CLI-0001/control', { mode: 'human' })).statusCode, 200);
    const reply = { id: randomUUID(), message: 'Bonjour, je reprends votre demande.' };
    assert.equal((await post('CLI-0001/messages', reply)).statusCode, 200);
    assert.equal((await post('CLI-0001/messages', reply)).statusCode, 200);
    assert.equal(
      (await post('CLI-0001/messages', { ...reply, message: 'Autre message' })).statusCode,
      409,
    );
    assert.equal((await post('CLI-0002/messages', reply)).statusCode, 409);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM chat_messages WHERE role='merchant'")).rows[0]
        .n,
      1,
    );
    const filtered = await app.inject({
      url: '/api/merchant/conversations?filter=escalated',
      headers: merchant,
    });
    assert.equal(filtered.json().conversations.length, 1);
    await post('CLI-0001/resolve', {});
    assert.equal(
      (await db.query("SELECT mode FROM conversations WHERE customer_id='CLI-0001'")).rows[0].mode,
      'human',
    );
    assert.equal((await merchantMetrics(db)).open_escalations, 0);
    await post('CLI-0001/control', { mode: 'auto' });
    // A retry after returning to Kenza must not silently retake control.
    await post('CLI-0001/messages', reply);
    assert.equal(
      (await db.query("SELECT mode FROM conversations WHERE customer_id='CLI-0001'")).rows[0].mode,
      'auto',
    );
    failAudit = true;
    await assert.rejects(() =>
      updateSupervision(db, 'CLI-0002', { id: randomUUID(), message: 'Must roll back' }),
    );
    failAudit = false;
    assert.equal(
      (await db.query("SELECT mode FROM conversations WHERE customer_id='CLI-0002'")).rows[0].mode,
      'auto',
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM chat_messages WHERE content='Must roll back'",
        )
      ).rows[0].n,
      0,
    );
    const now = new Date(Date.now() + 1000);
    await setCartItem(db, 'CLI-0001', { ref: 'REF-0006', quantity: 1 });
    for (let i = 0; i < 2; i++) {
      await setCartItem(db, 'CLI-0001', { ref: 'REF-0006', quantity: 1 });
      const quote = await prepareCheckout(
        db,
        'CLI-0001',
        {
          city: 'Casablanca',
          address: '12 rue de test',
          method: 'delivery',
          payment: 'cash_on_delivery',
        },
        now,
      );
      await confirmCheckout(db, 'CLI-0001', { quoteId: quote.id, confirmed: true }, now);
    }
    const metrics = await merchantMetrics(db);
    assert.equal(metrics.orders, 2);
    assert.equal(metrics.converted_customers, 1);
    assert.equal(metrics.conversion_percent, 50);
    assert.equal(metrics.sales_centimes, 43000);
    // Moving the first message after purchase removes conversion, not the orders.
    await db.query(
      "UPDATE chat_messages SET created_at=$1 WHERE customer_id='CLI-0001' AND role='user'",
      [new Date(now.getTime() + 1000)],
    );
    assert.equal((await merchantMetrics(db)).converted_customers, 0);
    const detail = (
      await app.inject({ url: '/api/merchant/conversations/CLI-0001', headers: merchant })
    ).json();
    assert.equal(detail.orders.length, 2);
    assert.ok(detail.customer.name);
    assert.deepEqual(detail.cart, []);
  } finally {
    await app.close();
    await engine.close();
  }
});
