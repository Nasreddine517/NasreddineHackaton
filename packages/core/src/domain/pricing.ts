export class BusinessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** All persisted and calculated money is in integer centimes. */
export function madToCentimes(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new BusinessError('INVALID_AMOUNT', 'Montant invalide.');
  const [whole, fraction = ''] = value.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result > 2_147_483_647)
    throw new BusinessError('INVALID_AMOUNT', 'Montant trop élevé.');
  return result;
}

export function moroccoDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Casablanca',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export type PriceInput = {
  baseCentimes: number;
  stock: number;
  discountPercent?: number;
  promotion?: { priceCentimes: number; startsOn: string; endsOn: string; condition: string };
  now?: Date;
};

export function quoteUnitPrice(input: PriceInput): {
  unitCentimes: number;
  source: 'catalogue' | 'promotion' | 'discount';
  discountPercent: number;
} {
  if (!Number.isSafeInteger(input.baseCentimes) || input.baseCentimes < 0)
    throw new BusinessError('INVALID_AMOUNT', 'Prix catalogue invalide.');
  if (!Number.isInteger(input.stock) || input.stock <= 0)
    throw new BusinessError('OUT_OF_STOCK', 'Article indisponible.');
  const day = moroccoDate(input.now ?? new Date());
  const promo = input.promotion;
  if (promo && promo.startsOn <= day && day <= promo.endsOn) {
    if (promo.condition !== 'dans la limite des stocks disponibles')
      throw new BusinessError(
        'PROMOTION_REVIEW_REQUIRED',
        'Conditions promotionnelles à vérifier.',
      );
    if (
      !Number.isSafeInteger(promo.priceCentimes) ||
      promo.priceCentimes < 0 ||
      promo.priceCentimes > input.baseCentimes
    )
      throw new BusinessError('INVALID_PROMOTION', 'Prix promotionnel à vérifier.');
    // Promotions take precedence: ignore any requested additional discount.
    return { unitCentimes: promo.priceCentimes, source: 'promotion', discountPercent: 0 };
  }
  const discount = input.discountPercent ?? 0;
  if (!Number.isInteger(discount) || discount < 0 || discount > 10)
    throw new BusinessError(
      'DISCOUNT_REQUIRES_HUMAN',
      'La remise nécessite une validation du commerçant.',
    );
  // Round upward to ensure rounding never crosses the authorized floor.
  const unitCentimes = Math.ceil((input.baseCentimes * (100 - discount)) / 100);
  return { unitCentimes, source: discount ? 'discount' : 'catalogue', discountPercent: discount };
}
