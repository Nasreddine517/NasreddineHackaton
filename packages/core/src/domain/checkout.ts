import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { quoteDelivery, searchProducts } from './catalogue.js';
import { BusinessError, quoteUnitPrice } from './pricing.js';

export const fulfillmentSchema = z
  .object({
    city: z.string().trim().min(1).max(100),
    method: z.enum(['delivery', 'pickup']),
    address: z.string().trim().max(400).default(''),
    payment: z.enum(['cash_on_delivery', 'bank_transfer', 'card_link']),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.method === 'delivery' && v.address.length < 5)
      ctx.addIssue({ code: 'custom', message: 'Adresse de livraison requise.', path: ['address'] });
    if (v.method === 'pickup' && v.payment === 'cash_on_delivery')
      ctx.addIssue({
        code: 'custom',
        message: 'Mode de paiement incompatible.',
        path: ['payment'],
      });
  });
type Fulfillment = z.infer<typeof fulfillmentSchema>;
type Line = {
  ref: string;
  model: string;
  size: string;
  quantity: number;
  unitCentimes: number;
  source: string;
};
export type CheckoutSnapshot = {
  lines: Line[];
  subtotalCentimes: number;
  totalCentimes: number;
  fulfillment: Fulfillment;
  delivery: Awaited<ReturnType<typeof quoteDelivery>>;
};

async function transaction<T>(pool: pg.Pool, action: (db: pg.PoolClient) => Promise<T>) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await action(db);
    await db.query('COMMIT');
    return result;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

async function lockCart(db: pg.PoolClient, customerId: string) {
  await db.query('INSERT INTO carts(customer_id) VALUES ($1) ON CONFLICT DO NOTHING', [customerId]);
  return (
    await db.query<{ revision: number }>(
      'SELECT revision FROM carts WHERE customer_id=$1 FOR UPDATE',
      [customerId],
    )
  ).rows[0]!.revision;
}

export async function getCart(db: Pick<pg.Pool, 'query'>, customerId: string) {
  return (
    await db.query(
      `SELECT i.product_ref AS ref, i.quantity, p.model, p.size, p.color, p.stock,
    p.price_centimes AS "catalogueCentimes" FROM cart_items i JOIN products p ON p.ref=i.product_ref
    WHERE i.customer_id=$1 ORDER BY i.product_ref`,
      [customerId],
    )
  ).rows;
}

export async function setCartItem(pool: pg.Pool, customerId: string, input: unknown, expectedRevision?: number) {
  const data = z
    .object({ ref: z.string().min(1).max(80), quantity: z.number().int().min(0).max(20) })
    .strict()
    .parse(input);
  return transaction(pool, async (db) => {
    const revision = await lockCart(db, customerId);
    if(expectedRevision !== undefined && revision !== expectedRevision)
      throw new BusinessError('CART_CHANGED','Votre panier a changé pendant ma réponse. Vérifiez-le avant de renouveler la demande.');
    const product = (await db.query('SELECT stock FROM products WHERE ref=$1', [data.ref])).rows[0];
    if (!product) throw new BusinessError('PRODUCT_NOT_FOUND', 'Cet article est introuvable.');
    if (data.quantity > product.stock)
      throw new BusinessError('OUT_OF_STOCK', 'La quantité demandée est indisponible.');
    if (data.quantity === 0)
      await db.query('DELETE FROM cart_items WHERE customer_id=$1 AND product_ref=$2', [
        customerId,
        data.ref,
      ]);
    else {
      const count = Number(
        (
          await db.query(
            'SELECT count(*) AS n FROM cart_items WHERE customer_id=$1 AND product_ref<>$2',
            [customerId, data.ref],
          )
        ).rows[0].n,
      );
      if (count >= 30)
        throw new BusinessError('CART_LIMIT', 'Le panier est limité à 30 références.');
      await db.query(
        `INSERT INTO cart_items(customer_id, product_ref, quantity) VALUES ($1,$2,$3)
        ON CONFLICT(customer_id,product_ref) DO UPDATE SET quantity=excluded.quantity`,
        [customerId, data.ref, data.quantity],
      );
    }
    await db.query('UPDATE carts SET revision=revision+1, updated_at=now() WHERE customer_id=$1', [
      customerId,
    ]);
    return getCart(db, customerId);
  });
}

async function snapshot(
  db: pg.PoolClient,
  customerId: string,
  fulfillment: Fulfillment,
  now: Date,
  discountPct?: number,
): Promise<CheckoutSnapshot> {
  const items = await getCart(db, customerId);
  if (!items.length) throw new BusinessError('EMPTY_CART', 'Votre panier est vide.');
  // Every checkout acquires product locks in the same order to avoid deadlocks.
  await db.query('SELECT ref FROM products WHERE ref=ANY($1::text[]) ORDER BY ref FOR UPDATE', [
    items.map((i) => i.ref),
  ]);
  // Keep promotion and delivery terms stable for this short transaction.
  await db.query('LOCK TABLE promotions, delivery_zones IN SHARE MODE');
  const lines: Line[] = [];
  for (const item of items) {
    const product = (await searchProducts(db, { query: item.ref, availableOnly: false }, now)).find(
      (p) => p.ref === item.ref,
    )!;
    if (!product || product.stock < item.quantity)
      throw new BusinessError(
        'OUT_OF_STOCK',
        'Un article du panier n’est plus disponible dans la quantité demandée.',
      );
    const price = quoteUnitPrice({
      baseCentimes: product.priceCentimes,
      stock: product.stock,
      promotion: product.promotion ?? undefined,
      // discountPct only applies when no active promotion; quoteUnitPrice enforces this.
      discountPercent: discountPct,
      now,
    });
    lines.push({
      ref: product.ref,
      model: product.model,
      size: product.size,
      quantity: item.quantity,
      unitCentimes: price.unitCentimes,
      source: price.source,
    });
  }
  const delivery = await quoteDelivery(
    db,
    fulfillment.city,
    fulfillment.method,
    fulfillment.payment === 'cash_on_delivery',
  );
  const subtotalCentimes = lines.reduce((s, l) => s + l.quantity * l.unitCentimes, 0);
  const totalCentimes = subtotalCentimes + delivery.feeCentimes;
  if (!Number.isSafeInteger(totalCentimes) || totalCentimes > 2_147_483_647)
    throw new BusinessError('INVALID_AMOUNT', 'Le montant doit être vérifié par le commerçant.');
  return {
    lines,
    subtotalCentimes,
    totalCentimes,
    fulfillment: { ...fulfillment, city: delivery.city },
    delivery,
  };
}

// PostgreSQL JSONB reorders object keys; compare values using a canonical encoding.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export async function prepareCheckout(
  pool: pg.Pool,
  customerId: string,
  input: unknown,
  now = new Date(),
  discountPct?: number,
) {
  const fulfillment = fulfillmentSchema.parse(input);
  return transaction(pool, async (db) => {
    const revision = await lockCart(db, customerId);
    const quote = await snapshot(db, customerId, fulfillment, now, discountPct);
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
    await db.query(
      'INSERT INTO checkout_quotes(id, customer_id, revision, snapshot, expires_at) VALUES ($1,$2,$3,$4,$5)',
      [id, customerId, revision, JSON.stringify(quote), expiresAt],
    );
    return { id, expiresAt, ...quote };
  });
}

export async function confirmCheckout(
  pool: pg.Pool,
  customerId: string,
  input: unknown,
  now = new Date(),
) {
  const { quoteId } = z
    .object({ quoteId: z.string().uuid(), confirmed: z.literal(true) })
    .strict()
    .parse(input);
  return transaction(pool, async (db) => {
    const revision = await lockCart(db, customerId);
    const quote = (
      await db.query<{
        revision: number;
        snapshot: CheckoutSnapshot;
        expires_at: Date;
        order_id: string | null;
      }>(
        'SELECT revision, snapshot, expires_at, order_id FROM checkout_quotes WHERE id=$1 AND customer_id=$2 FOR UPDATE',
        [quoteId, customerId],
      )
    ).rows[0];
    if (!quote) throw new BusinessError('QUOTE_NOT_FOUND', 'Récapitulatif introuvable.');
    // A retry after a lost response returns the original order, even if the cart has changed since.
    if (quote.order_id) return { orderId: quote.order_id, alreadyConfirmed: true };
    if (quote.expires_at.getTime() <= now.getTime())
      throw new BusinessError(
        'QUOTE_EXPIRED',
        'Le récapitulatif a expiré. Veuillez le recalculer.',
      );
    if (revision !== quote.revision)
      throw new BusinessError(
        'CART_CHANGED',
        'Le panier a changé. Veuillez vérifier le nouveau récapitulatif.',
      );
    const current = await snapshot(db, customerId, quote.snapshot.fulfillment, now);
    if (canonical(current) !== canonical(quote.snapshot))
      throw new BusinessError(
        'PRICE_CHANGED',
        'Les conditions ont changé. Veuillez recalculer puis confirmer le nouveau récapitulatif.',
      );
    const id = `KEN-${randomUUID()}`;
    await db.query(
      `INSERT INTO orders(id, customer_id, created_at, channel, status, subtotal_centimes, delivery_centimes, total_centimes,
      delivery_city, delivery_address, payment_method, source, idempotency_key, fulfillment_method)
      VALUES ($1,$2,$3,'web','confirmed',$4,$5,$6,$7,$8,$9,'kenza',$10,$11)`,
      [
        id,
        customerId,
        now,
        current.subtotalCentimes,
        current.delivery.feeCentimes,
        current.totalCentimes,
        current.delivery.city,
        current.fulfillment.address || null,
        current.fulfillment.payment,
        quoteId,
        current.fulfillment.method,
      ],
    );
    for (const [index, line] of current.lines.entries()) {
      await db.query('UPDATE products SET stock=stock-$2, updated_at=now() WHERE ref=$1', [
        line.ref,
        line.quantity,
      ]);
      await db.query(
        `INSERT INTO order_lines(order_id,line_number,product_ref,model,size,quantity,unit_price_centimes,price_source)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          index + 1,
          line.ref,
          line.model,
          line.size,
          line.quantity,
          line.unitCentimes,
          line.source,
        ],
      );
    }
    await db.query('UPDATE checkout_quotes SET order_id=$2 WHERE id=$1', [quoteId, id]);
    await db.query('DELETE FROM cart_items WHERE customer_id=$1', [customerId]);
    await db.query('UPDATE carts SET revision=revision+1, updated_at=now() WHERE customer_id=$1', [
      customerId,
    ]);
    return { orderId: id, alreadyConfirmed: false };
  });
}
