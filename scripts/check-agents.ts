import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { readConfig } from '../packages/core/src/config.js';
import { migrate } from '../packages/core/src/db/migrate.js';
import { seed } from '../packages/core/src/db/seed.js';
import { createAgentModels } from '../packages/core/src/agents/models.js';
import { createConversationService } from '../packages/core/src/agents/conversation.js';
import { confirmCheckout } from '../packages/core/src/domain/checkout.js';

// Explicit live diagnostic: synthetic messages, isolated schema, no storefront stock changes.
const config = readConfig();
const schema = `test_live_agents_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: config.DATABASE_URL });
const db = new pg.Pool({
  connectionString: config.DATABASE_URL,
  options: `-c search_path=${schema}`,
  max: 10,
});
try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await migrate(db);
  await seed(db);
  let service = await createConversationService(db, createAgentModels(config), () => {}, schema);
  const customer = 'CLI-0001';
  for (const message of [
    'Salam, bghit un foulard bleu. Ana kanfaddel le bleu, t9der t3a9el 3liha ?',
    'Ajoute une unité de REF-0006 à mon panier.',
    'Prépare le récapitulatif : livraison à Casablanca, 12 rue fictive, paiement à la livraison.',
  ]) {
    const start = Date.now();
    const result = await service.send(customer, { id: randomUUID(), message });
    const last = result.messages.at(-1);
    const status = (
      await db.query(
        'SELECT status FROM chat_turns WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 1',
        [customer],
      )
    ).rows[0].status;
    console.log(
      JSON.stringify({
        stage: 'live_turn',
        status,
        durationMs: Date.now() - start,
        hasProducts: Boolean(last?.metadata.products?.length),
        hasQuote: Boolean(last?.metadata.quote),
        memoryCount: result.memory.length,
      }),
    );
    if (status !== 'completed') {
      console.log(
        JSON.stringify(
          (
            await db.query(
              "SELECT details FROM agent_events WHERE action='turn_failed' ORDER BY id DESC LIMIT 1",
            )
          ).rows,
        ),
      );
      throw new Error('LIVE_CHECK_FAILED');
    }
    if (
      message.startsWith('Salam') &&
      !last?.metadata.products?.some((p: { ref: string }) => p.ref === 'REF-0006')
    )
      throw new Error('SEARCH_MISSED_BLUE_VARIANT');
  }
  service = await createConversationService(db, createAgentModels(config), () => {}, schema);
  const state = await service.graph.getState({ configurable: { thread_id: customer } });
  if (state.values.context.customerId !== customer) throw new Error('CHECKPOINT_NOT_RESTORED');
  const quote = (
    await db.query(
      'SELECT id FROM checkout_quotes WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 1',
      [customer],
    )
  ).rows[0]?.id;
  const cart = (
    await db.query('SELECT quantity FROM cart_items WHERE customer_id=$1 AND product_ref=$2', [
      customer,
      'REF-0006',
    ])
  ).rows[0];
  if (!quote || cart?.quantity !== 1) throw new Error('TOOLS_NOT_APPLIED');
  const confirmed = await confirmCheckout(db, customer, { quoteId: quote, confirmed: true });
  const order = (
    await db.query('SELECT total_centimes FROM orders WHERE id=$1', [confirmed.orderId])
  ).rows[0];
  if (order?.total_centimes !== 21500) throw new Error('INCORRECT_ORDER_TOTAL');
  const recalled = await service.send(customer, {
    id: randomUUID(),
    message: 'Rappelle-moi en français la couleur que je préfère.',
  });
  if (!/bleu/i.test(recalled.messages.at(-1)?.content ?? ''))
    throw new Error('MEMORY_NOT_RECALLED');
  console.log(
    'Memory recalled after graph reconstruction; explicit checkout persisted at 215 MAD.',
  );
  console.log(
    'Live structured calls, cart tool, checkout quote and graph reconstruction verified.',
  );
} catch {
  console.error('Agent diagnostic failed; inspect sanitized stage results above.');
  process.exitCode = 1;
} finally {
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
