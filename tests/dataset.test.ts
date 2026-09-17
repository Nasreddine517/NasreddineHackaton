import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDataset } from '../packages/core/src/db/dataset.js';

test('provided corpus parses and historical line totals reconcile', async () => {
  const { tables, examples } = await loadDataset();
  assert.equal(tables['catalogue.csv']?.length, 80);
  assert.equal(tables['clients.csv']?.length, 120);
  assert.equal(tables['commandes.csv']?.length, 320);
  assert.equal(tables['commandes-lignes.csv']?.length, 449);
  assert.equal(tables['livraison.csv']?.length, 12);
  assert.equal(tables['promotions.csv']?.length, 12);
  assert.equal(examples.length, 40);
});
