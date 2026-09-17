import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { madToCentimes } from '../domain/pricing.js';

export const datasetFiles = [
  'catalogue.csv',
  'clients.csv',
  'commandes.csv',
  'commandes-lignes.csv',
  'livraison.csv',
  'promotions.csv',
  'conversations.jsonl',
] as const;
export type CsvRow = Record<string, string>;
export function required(row: CsvRow, column: string): string {
  const value = row[column];
  if (value === undefined || value === '') throw new Error(`Missing dataset column: ${column}`);
  return value;
}
export function nonnegativeInteger(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error('Invalid integer in dataset.');
  return Number(value);
}
export function yesNo(value: string): boolean {
  if (!['oui', 'non'].includes(value)) throw new Error('Invalid yes/no value in dataset.');
  return value === 'oui';
}

export async function loadDataset(directory = resolve('Data/seed')) {
  const contents = await Promise.all(
    datasetFiles.map(async (name) => ({
      name,
      text: (await readFile(resolve(directory, name), 'utf8')).replace(/\r\n/g, '\n'),
    })),
  );
  const checksum = createHash('sha256');
  const tables: Record<string, CsvRow[]> = {};
  let examples: Array<{ id: string; [key: string]: unknown }> = [];
  for (const { name, text } of contents) {
    checksum.update(name).update('\0').update(text).update('\0');
    if (name.endsWith('.jsonl')) {
      examples = text
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
      if (examples.some((e) => typeof e.id !== 'string'))
        throw new Error('Invalid conversation example.');
    } else
      tables[name] = parse(text, {
        columns: true,
        bom: true,
        skip_empty_lines: true,
        trim: true,
      }) as CsvRow[];
  }
  // Fail before writing if the supplied historical totals are inconsistent.
  const orderLines = tables['commandes-lignes.csv']!;
  for (const order of tables['commandes.csv']!) {
    const subtotal = madToCentimes(required(order, 'total_articles_mad'));
    const total = madToCentimes(required(order, 'total_mad'));
    if (subtotal + madToCentimes(required(order, 'frais_livraison_mad')) !== total)
      throw new Error(`Invalid order total: ${order.commande_id}`);
    const linesTotal = orderLines
      .filter((line) => line.commande_id === order.commande_id)
      .reduce(
        (sum, line) =>
          sum +
          nonnegativeInteger(required(line, 'quantite')) *
            madToCentimes(required(line, 'prix_unitaire_mad')),
        0,
      );
    if (linesTotal !== subtotal) throw new Error(`Invalid order lines: ${order.commande_id}`);
  }
  return { tables, examples, checksum: checksum.digest('hex') };
}
