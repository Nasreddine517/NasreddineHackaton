import type pg from 'pg';
import { z } from 'zod';
import { BusinessError, moroccoDate } from './pricing.js';

export const searchSchema = z.object({
  query: z.string().trim().max(120).default(''),
  family: z.string().trim().max(80).optional(),
  color: z.string().trim().max(80).optional(),
  size: z.string().trim().max(30).optional(),
  availableOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(30).default(12),
});

export type Product = {
  ref: string;
  model: string;
  family: string;
  color: string;
  size: string;
  material: string;
  priceCentimes: number;
  stock: number;
  promotion: { priceCentimes: number; startsOn: string; endsOn: string; condition: string } | null;
};

export async function searchProducts(
  db: Pick<pg.Pool, 'query'>,
  input: z.input<typeof searchSchema>,
  now = new Date(),
): Promise<Product[]> {
  const data = searchSchema.parse(input);
  // Escape wildcard syntax: user input is a literal search, never SQL or a LIKE pattern.
  const pattern = `%${data.query.replace(/[\\%_]/g, '\\$&')}%`;
  const result = await db.query(
    `SELECT p.ref, p.model, p.family, p.color, p.size, p.material,
    p.price_centimes AS "priceCentimes", p.stock,
    CASE WHEN promo.id IS NULL THEN NULL ELSE json_build_object(
      'priceCentimes', promo.price_centimes, 'startsOn', promo.starts_on::text,
      'endsOn', promo.ends_on::text, 'condition', promo.condition) END AS promotion
    FROM products p
    LEFT JOIN LATERAL (
      SELECT * FROM promotions WHERE product_ref = p.ref AND starts_on <= $1::date AND ends_on >= $1::date
      ORDER BY price_centimes ASC, id ASC LIMIT 1
    ) promo ON true
    WHERE (p.model ILIKE $2 OR p.family ILIKE $2 OR p.color ILIKE $2 OR p.ref ILIKE $2)
      AND ($3::text IS NULL OR lower(p.family) = lower($3))
      AND ($4::text IS NULL OR lower(p.color) = lower($4))
      AND ($5::text IS NULL OR lower(p.size) = lower($5))
      AND (NOT $6::boolean OR p.stock > 0)
    ORDER BY p.ref LIMIT $7`,
    [
      moroccoDate(now),
      pattern,
      data.family ?? null,
      data.color ?? null,
      data.size ?? null,
      data.availableOnly,
      data.limit,
    ],
  );
  // Never expose restock_days_internal to the customer-facing catalogue tool.
  return result.rows as Product[];
}

export function normalizeCity(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

type DeliveryZone = {
  city: string;
  fee_centimes: number;
  delay_hours: number;
  cash_on_delivery: boolean;
  pickup: boolean;
};
export async function quoteDelivery(
  db: Pick<pg.Pool, 'query'>,
  city: string,
  method: 'delivery' | 'pickup',
  cashOnDelivery: boolean,
) {
  const zones = (
    await db.query<DeliveryZone>(
      'SELECT city, fee_centimes, delay_hours, cash_on_delivery, pickup FROM delivery_zones',
    )
  ).rows;
  const normalized = normalizeCity(city);
  const aliases: Record<string, string> = {
    casa: 'casablanca',
    fes: 'fes',
    فاس: 'fes',
    'الدار البيضاء': 'casablanca',
  };
  const target = aliases[normalized] ?? normalized;
  const zone = zones.find((z) => normalizeCity(z.city) === target);
  if (!zone)
    throw new BusinessError(
      'CITY_REQUIRES_HUMAN',
      'Cette destination doit être vérifiée par le commerçant.',
    );
  if (method === 'pickup') {
    if (!zone.pickup)
      throw new BusinessError(
        'PICKUP_UNAVAILABLE',
        'Le retrait est indisponible dans cette ville.',
      );
    // FAQ explicitly provides pickup under 24h; shipping delay is a separate value.
    return { city: zone.city, feeCentimes: 0, delayHours: 24, method, cashOnDelivery: false };
  }
  if (cashOnDelivery && !zone.cash_on_delivery)
    throw new BusinessError(
      'COD_UNAVAILABLE',
      'Le paiement à la livraison est indisponible dans cette ville.',
    );
  return {
    city: zone.city,
    feeCentimes: zone.fee_centimes,
    delayHours: zone.delay_hours,
    method,
    cashOnDelivery: zone.cash_on_delivery,
  };
}
