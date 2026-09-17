import type pg from 'pg';
import { loadDataset, nonnegativeInteger as integer, required as field, yesNo } from './dataset.js';
import { madToCentimes as money } from '../domain/pricing.js';

export async function seed(pool: pg.Pool, directory?: string) {
  const dataset = await loadDataset(directory);
  const table = (name: string) => dataset.tables[name]!;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(72631002)');
    const existing = await client.query<{ checksum: string }>(
      'SELECT checksum FROM seed_runs WHERE name = $1',
      ['kenza-provided-v1'],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== dataset.checksum)
        throw new Error(
          'Dataset changed after import. A deliberate migration is required; current data was preserved.',
        );
      await client.query('COMMIT');
      console.info('Dataset already imported; live stock and orders preserved.');
      return { imported: false };
    }
    for (const r of table('catalogue.csv')) {
      await client.query(
        `INSERT INTO products (ref, model, family, gender, color, size, material, season, price_centimes, stock, restock_days_internal, barcode, weight_g)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          field(r, 'ref'),
          field(r, 'modele'),
          field(r, 'famille'),
          field(r, 'genre'),
          field(r, 'couleur'),
          field(r, 'taille'),
          field(r, 'matiere'),
          field(r, 'saison'),
          money(field(r, 'prix_mad')),
          integer(field(r, 'stock')),
          r.delai_reassort_jours ? integer(r.delai_reassort_jours) : null,
          field(r, 'code_barre'),
          integer(field(r, 'poids_g')),
        ],
      );
    }
    for (const r of table('clients.csv')) {
      await client.query(
        `INSERT INTO customers (id,name,phone,city,preferred_language,first_purchase,historical_order_count,segment,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'historical')`,
        [
          field(r, 'client_id'),
          field(r, 'nom'),
          field(r, 'telephone'),
          field(r, 'ville'),
          field(r, 'langue_preferee'),
          r.premier_achat || null,
          integer(field(r, 'nb_commandes')),
          field(r, 'segment'),
        ],
      );
    }
    for (const r of table('livraison.csv')) {
      await client.query(
        'INSERT INTO delivery_zones (city,fee_centimes,delay_hours,cash_on_delivery,pickup) VALUES ($1,$2,$3,$4,$5)',
        [
          field(r, 'ville'),
          money(field(r, 'frais_mad')),
          integer(field(r, 'delai_heures')),
          yesNo(field(r, 'paiement_a_la_livraison')),
          yesNo(field(r, 'retrait_boutique')),
        ],
      );
    }
    for (const r of table('promotions.csv')) {
      await client.query(
        'INSERT INTO promotions (product_ref,price_centimes,starts_on,ends_on,condition) VALUES ($1,$2,$3,$4,$5)',
        [
          field(r, 'ref'),
          money(field(r, 'prix_promo_mad')),
          field(r, 'debut'),
          field(r, 'fin'),
          field(r, 'condition'),
        ],
      );
    }
    for (const r of table('commandes.csv')) {
      await client.query(
        `INSERT INTO orders (id,customer_id,created_at,channel,status,subtotal_centimes,delivery_centimes,total_centimes,delivery_city,payment_method,source)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'historical')`,
        [
          field(r, 'commande_id'),
          field(r, 'client_id'),
          `${field(r, 'date')}T00:00:00Z`,
          field(r, 'canal'),
          field(r, 'statut'),
          money(field(r, 'total_articles_mad')),
          money(field(r, 'frais_livraison_mad')),
          money(field(r, 'total_mad')),
          field(r, 'ville_livraison'),
          field(r, 'paiement'),
        ],
      );
    }
    const lineNumbers = new Map<string, number>();
    for (const r of table('commandes-lignes.csv')) {
      const orderId = field(r, 'commande_id');
      const n = (lineNumbers.get(orderId) ?? 0) + 1;
      lineNumbers.set(orderId, n);
      await client.query(
        'INSERT INTO order_lines (order_id,line_number,product_ref,model,size,quantity,unit_price_centimes) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          orderId,
          n,
          field(r, 'ref'),
          field(r, 'modele'),
          field(r, 'taille'),
          integer(field(r, 'quantite')),
          money(field(r, 'prix_unitaire_mad')),
        ],
      );
    }
    for (const example of dataset.examples) {
      await client.query('INSERT INTO conversation_examples (id,payload) VALUES ($1,$2::jsonb)', [
        example.id,
        JSON.stringify(example),
      ]);
    }
    await client.query('INSERT INTO seed_runs (name,checksum) VALUES ($1,$2)', [
      'kenza-provided-v1',
      dataset.checksum,
    ]);
    await client.query('COMMIT');
    console.info('Dataset imported: 80 products, 120 customers, 320 historical orders.');
    return { imported: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
