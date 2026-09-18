import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../apps/api/src/app.js';
import type { createConnections } from '../packages/core/src/connections.js';

test('commerce API isolates merchant sessions, checks CSRF, rotates and revokes cookies, limits login attempts', async () => {
  const sessions = new Map<string, string>();
  const attempts = new Map<string, number>();
  const dependencies = {
    db: {
      query: async (sql: string) => ({
        rows: sql.includes("o.source='kenza'")
          ? [{ id: 'KEN-private' }]
          : [{ id: 'CLIENT-demo', name: 'Profil fictif' }],
      }),
    },
    redis: {
      get: async (key: string) => sessions.get(key) ?? null,
      set: async (key: string, value: string) => {
        sessions.set(key, value);
      },
      del: async (key: string) => {
        sessions.delete(key);
      },
      eval: async (_script: string, _n: number, key: string) => {
        const n = (attempts.get(key) ?? 0) + 1;
        attempts.set(key, n);
        return n;
      },
    },
    close: async () => {},
  } as unknown as ReturnType<typeof createConnections>;
  const app = await createApp(dependencies, 'silent', {
    MERCHANT_EMAIL: 'test@example.test',
    MERCHANT_PASSWORD: 'only-for-test-password',
    COOKIE_SECURE: true,
  });
  const headers = { 'x-kenza-request': '1' };
  const login = { email: 'test@example.test', password: 'only-for-test-password' };
  const cookieOf = (value: string | string[] | undefined) => String(value).split(';')[0]!;
  try {
    assert.equal((await app.inject('/api/merchant/orders')).statusCode, 401);
    assert.equal((await app.inject('/api/client/cart')).statusCode, 401);
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/merchant/login', payload: login })).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/merchant/login',
          headers: { ...headers, 'sec-fetch-site': 'cross-site' },
          payload: login,
        })
      ).statusCode,
      403,
    );
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/merchant/login',
      headers,
      payload: { ...login, password: 'wrong' },
    });
    assert.equal(invalid.statusCode, 401);
    assert.equal(invalid.body.includes(login.password), false);
    const client = await app.inject({
      method: 'POST',
      url: '/api/demo/session',
      headers,
      payload: { customerId: 'CLIENT-demo' },
    });
    assert.equal(client.statusCode, 200);
    assert.equal(
      (
        await app.inject({
          url: '/api/merchant/orders',
          headers: { cookie: cookieOf(client.headers['set-cookie']) },
        })
      ).statusCode,
      401,
    );
    const first = await app.inject({
      method: 'POST',
      url: '/api/merchant/login',
      headers,
      payload: login,
    });
    assert.equal(first.statusCode, 200);
    assert.match(
      String(first.headers['set-cookie']),
      /HttpOnly; SameSite=Strict; Path=\/api; Max-Age=28800; Secure/,
    );
    const firstCookie = cookieOf(first.headers['set-cookie']);
    assert.equal(
      (await app.inject({ url: '/api/merchant/orders', headers: { cookie: firstCookie } })).json()
        .orders[0].id,
      'KEN-private',
    );
    assert.equal(
      (await app.inject({ url: '/api/client/cart', headers: { cookie: firstCookie } })).statusCode,
      401,
    );
    const second = await app.inject({
      method: 'POST',
      url: '/api/merchant/login',
      headers: { ...headers, cookie: firstCookie },
      payload: login,
    });
    const secondCookie = cookieOf(second.headers['set-cookie']);
    assert.notEqual(firstCookie, secondCookie);
    assert.equal(
      (await app.inject({ url: '/api/merchant/orders', headers: { cookie: firstCookie } }))
        .statusCode,
      401,
    );
    await app.inject({
      method: 'POST',
      url: '/api/merchant/logout',
      headers: { ...headers, cookie: secondCookie },
      payload: {},
    });
    assert.equal(
      (await app.inject({ url: '/api/merchant/orders', headers: { cookie: secondCookie } }))
        .statusCode,
      401,
    );
    for (let i = 0; i < 10; i++)
      await app.inject({
        method: 'POST',
        url: '/api/merchant/login',
        headers,
        payload: { ...login, password: 'wrong' },
      });
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/merchant/login', headers, payload: login }))
        .statusCode,
      429,
    );
  } finally {
    await app.close();
  }
});
