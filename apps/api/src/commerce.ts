import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { createConnections } from '../../../packages/core/src/connections.js';
import { searchProducts } from '../../../packages/core/src/domain/catalogue.js';
import {
  confirmCheckout,
  getCart,
  prepareCheckout,
  setCartItem,
} from '../../../packages/core/src/domain/checkout.js';

export type MerchantConfig = {
  MERCHANT_EMAIL: string;
  MERCHANT_PASSWORD: string;
  COOKIE_SECURE: boolean;
};
const digest = (value: string) => createHash('sha256').update(value).digest();
const equal = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));
const denied = (statusCode: number) => Object.assign(new Error('Access denied'), { statusCode });

export async function registerCommerce(
  app: FastifyInstance,
  { db, redis }: ReturnType<typeof createConnections>,
  config: MerchantConfig,
) {
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store');
    return payload;
  });
  app.addHook('onRequest', async (request) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    // A custom header cannot be sent cross-origin without a CORS preflight.
    // This API never enables CORS. Reject cross-site browser requests as well.
    if (
      request.headers['x-kenza-request'] !== '1' ||
      request.headers['sec-fetch-site'] === 'cross-site'
    )
      throw denied(403);
  });
  function token(request: FastifyRequest, role: string) {
    const value = request.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith(`kenza_${role}=`))
      ?.split('=')[1];
    return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
  }
  async function session(request: FastifyRequest, role: string) {
    const value = token(request, role);
    const id = value ? await redis.get(`session:${role}:${digest(value).toString('hex')}`) : null;
    if (!id) throw denied(401);
    return id;
  }
  async function issue(request: FastifyRequest, reply: FastifyReply, role: string, id: string) {
    const old = token(request, role);
    if (old) await redis.del(`session:${role}:${digest(old).toString('hex')}`);
    const value = randomBytes(32).toString('hex');
    await redis.set(`session:${role}:${digest(value).toString('hex')}`, id, 'EX', 28800);
    reply.header(
      'set-cookie',
      `kenza_${role}=${value}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=28800${config.COOKIE_SECURE ? '; Secure' : ''}`,
    );
  }
  async function rateLimit(key: string, limit: number) {
    const count = Number(
      await redis.eval(
        `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],300) end; return n`,
        1,
        key,
      ),
    );
    if (count > limit) throw denied(429);
  }
  app.get('/api/demo/profiles', async () => ({
    profiles: (await db.query('SELECT id, name FROM customers ORDER BY id LIMIT 200')).rows,
  }));
  app.post('/api/demo/session', async (request, reply) => {
    await rateLimit(`rate:demo:${request.ip}`, 60);
    const data = z
      .union([
        z.object({ customerId: z.string().min(1).max(80) }).strict(),
        z
          .object({
            name: z.string().trim().min(2).max(80),
            city: z.string().trim().min(1).max(100),
          })
          .strict(),
      ])
      .parse(request.body);
    let id: string;
    if ('customerId' in data) {
      id = data.customerId;
      if (!(await db.query('SELECT id FROM customers WHERE id=$1', [id])).rows.length)
        throw denied(404);
    } else {
      id = `DEMO-${randomUUID()}`;
      await db.query(
        `INSERT INTO customers(id,name,phone,city,preferred_language,historical_order_count,segment,source)
        VALUES ($1,$2,'',$3,'fr',0,'nouveau','demo')`,
        [id, data.name, data.city],
      );
    }
    await issue(request, reply, 'client', id);
    return { customerId: id };
  });
  app.get('/api/client/me', async (request) => {
    const id = await session(request, 'client');
    return (await db.query('SELECT id,name,city FROM customers WHERE id=$1', [id])).rows[0];
  });
  app.get('/api/catalogue', async (request) => {
    const { q } = z.object({ q: z.string().max(120).default('') }).parse(request.query);
    return { products: await searchProducts(db, { query: q, limit: 30 }) };
  });
  app.get('/api/delivery-zones', async () => ({
    zones: (
      await db.query(
        'SELECT city,fee_centimes,delay_hours,cash_on_delivery,pickup FROM delivery_zones ORDER BY city',
      )
    ).rows,
  }));
  app.get('/api/client/cart', async (request) => ({
    items: await getCart(db, await session(request, 'client')),
  }));
  app.put('/api/client/cart', async (request) => ({
    items: await setCartItem(db, await session(request, 'client'), request.body),
  }));
  app.post('/api/client/checkout/quote', async (request) =>
    prepareCheckout(db, await session(request, 'client'), request.body),
  );
  app.post('/api/client/checkout/confirm', async (request) =>
    confirmCheckout(db, await session(request, 'client'), request.body),
  );
  app.get('/api/client/orders', async (request) => {
    const id = await session(request, 'client');
    return {
      orders: (
        await db.query(
          `SELECT id,created_at,status,total_centimes,payment_method FROM orders WHERE customer_id=$1 AND source='kenza' ORDER BY created_at DESC LIMIT 50`,
          [id],
        )
      ).rows,
    };
  });
  app.post('/api/merchant/login', async (request, reply) => {
    await rateLimit(`rate:merchant:${request.ip}`, 10);
    const data = z
      .object({ email: z.string().max(254), password: z.string().max(256) })
      .strict()
      .parse(request.body);
    if (!config.MERCHANT_EMAIL || !config.MERCHANT_PASSWORD) throw denied(503);
    if (
      !equal(data.email.toLowerCase(), config.MERCHANT_EMAIL.toLowerCase()) ||
      !equal(data.password, config.MERCHANT_PASSWORD)
    )
      throw denied(401);
    await issue(request, reply, 'merchant', 'merchant');
    return { authenticated: true };
  });
  app.post('/api/merchant/logout', async (request, reply) => {
    const value = token(request, 'merchant');
    if (value) await redis.del(`session:merchant:${digest(value).toString('hex')}`);
    reply.header(
      'set-cookie',
      `kenza_merchant=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${config.COOKIE_SECURE ? '; Secure' : ''}`,
    );
    return { authenticated: false };
  });
  app.get('/api/merchant/orders', async (request) => {
    await session(request, 'merchant');
    return {
      orders: (
        await db.query(`SELECT o.id,o.created_at,o.status,o.total_centimes,o.delivery_centimes,o.delivery_city,o.delivery_address,
      o.payment_method,o.fulfillment_method,c.name AS customer_name,
      (SELECT json_agg(json_build_object('ref',l.product_ref,'model',l.model,'size',l.size,'quantity',l.quantity,'unitCentimes',l.unit_price_centimes) ORDER BY l.line_number)
        FROM order_lines l WHERE l.order_id=o.id) AS lines
      FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.source='kenza' ORDER BY o.created_at DESC LIMIT 100`)
      ).rows,
    };
  });
}
