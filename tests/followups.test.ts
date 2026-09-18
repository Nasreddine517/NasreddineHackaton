import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../packages/core/src/db/migrate.js';
import { seed } from '../packages/core/src/db/seed.js';
import {
  setCartItem,
  prepareCheckout,
  confirmCheckout,
} from '../packages/core/src/domain/checkout.js';
import { reconcileFollowups, followupReport } from '../packages/core/src/domain/followups.js';
import { createFollowupService } from '../packages/core/src/agents/followup.js';
import { updateSupervision } from '../packages/core/src/domain/supervision.js';
import { startFollowupWorker } from '../packages/core/src/followup-worker.js';
import type { FollowupModels } from '../packages/core/src/agents/models.js';

const models: FollowupModels = {
  decide: async () => ({
    eligible: true,
    reason: 'helpful',
    message: 'Souhaitez-vous de l’aide pour terminer votre panier ?',
  }),
  audit: async () => true,
};
const delivery = {
  city: 'Casablanca',
  address: '12 rue de test',
  method: 'delivery',
  payment: 'cash_on_delivery',
};

async function fixture(fn: (db: pg.Pool) => Promise<void>) {
  const schema = `test_followups_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const db = new pg.Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    options: `-c search_path=${schema}`,
    max: 10,
  });
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await migrate(db);
    await seed(db);
    await fn(db);
  } finally {
    await db.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
}
async function message(db: pg.Pool, id: string, at = new Date(Date.now() - 31 * 60000)) {
  await db.query('INSERT INTO conversations(customer_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
  const turn = randomUUID();
  await db.query(
    "INSERT INTO chat_turns(id,customer_id,input,status) VALUES ($1,$2,'Je réfléchis','completed')",
    [turn, id],
  );
  await db.query(
    "INSERT INTO chat_messages(customer_id,turn_id,role,content,created_at) VALUES ($1,$2,'user','Je réfléchis',$3)",
    [id, turn, at],
  );
  await db.query('UPDATE conversations SET last_client_message_at=$2 WHERE customer_id=$1', [
    id,
    at,
  ]);
  await setCartItem(db, id, { ref: 'REF-0006', quantity: 1 });
}
async function scheduled(db: pg.Pool, id: string, delay = 1800000) {
  await reconcileFollowups(db, delay);
  return (
    await db.query(
      'SELECT * FROM followups WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 1',
      [id],
    )
  ).rows[0];
}
async function status(db: pg.Pool, id: string) {
  return (await db.query('SELECT * FROM followups WHERE id=$1', [id])).rows[0];
}

test(
  'PostgreSQL follow-ups: exact deadline, invalidation, idempotency, guard and 24h attribution',
  { skip: !process.env.TEST_DATABASE_URL },
  async () =>
    fixture(async (db) => {
      const service = createFollowupService(db, models);
      const midnight = new Date('2026-09-18T00:00:00Z');
      await message(db, 'CLI-0001', midnight);
      let row = await scheduled(db, 'CLI-0001');
      assert.equal(row.due_at.toISOString(), '2026-09-18T00:30:00.000Z');
      await assert.rejects(() => service.process(row.id, new Date('2026-09-18T00:29:59Z')));
      const original = row;
      await message(db, 'CLI-0001', new Date('2026-09-18T00:10:00Z'));
      assert.equal((await status(db, original.id)).reason, 'new_message');
      row = await scheduled(db, 'CLI-0001');
      assert.equal(row.due_at.toISOString(), '2026-09-18T00:40:00.000Z');
      assert.equal(row.variant, original.variant);
      assert.equal(await service.process(original.id), null);
      const concurrent = await Promise.allSettled([
        service.process(row.id),
        service.process(row.id),
      ]);
      assert.ok(concurrent.some((result) => result.status === 'fulfilled'));
      await service.process(row.id);
      assert.equal((await status(db, row.id)).status, 'sent');
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM chat_messages WHERE customer_id='CLI-0001' AND role='assistant'",
          )
        ).rows[0].n,
        1,
      );
      await reconcileFollowups(db, 1800000);
      assert.equal(
        (await db.query("SELECT count(*)::int AS n FROM followups WHERE customer_id='CLI-0001'"))
          .rows[0].n,
        2,
      );
      // A response and order are attributed once, never to the imported historical orders.
      await message(db, 'CLI-0001', new Date());
      assert.ok((await status(db, row.id)).response_at);
      const quote = await prepareCheckout(db, 'CLI-0001', delivery);
      const order = await confirmCheckout(db, 'CLI-0001', { quoteId: quote.id, confirmed: true });
      assert.equal((await status(db, row.id)).order_id, order.orderId);
      const report = await followupReport(db);
      assert.equal(
        report.variants.reduce((n, v) => n + v.orders, 0),
        1,
      );
      assert.equal(
        report.variants.reduce((n, v) => n + v.responses, 0),
        1,
      );

      for (const [id, action] of [
        ['CLI-0002', 'refused'],
        ['CLI-0003', 'human'],
        ['CLI-0004', 'order'],
        ['CLI-0005', 'stock'],
        ['CLI-0006', 'empty'],
      ] as const) {
        await message(db, id);
        const pending = await scheduled(db, id);
        if (action === 'refused')
          await db.query('UPDATE conversations SET followup_refused=true WHERE customer_id=$1', [
            id,
          ]);
        if (action === 'human') await updateSupervision(db, id, { mode: 'human' });
        if (action === 'order') {
          const q = await prepareCheckout(db, id, delivery);
          await confirmCheckout(db, id, { quoteId: q.id, confirmed: true });
        }
        if (action === 'stock') await db.query("UPDATE products SET stock=0 WHERE ref='REF-0006'");
        if (action === 'empty') await setCartItem(db, id, { ref: 'REF-0006', quantity: 0 });
        assert.equal(await service.process(pending.id), null);
        assert.equal((await status(db, pending.id)).status, 'cancelled');
        if (action === 'human') {
          await updateSupervision(db, id, { mode: 'auto' });
          await reconcileFollowups(db, 1800000);
          assert.equal((await status(db, pending.id)).status, 'cancelled');
        }
        await db.query("UPDATE products SET stock=20 WHERE ref='REF-0006'");
      }
      // A handoff before the outbox pump runs must not generate a late reminder.
      await message(db, 'CLI-0007');
      await updateSupervision(db, 'CLI-0007', { mode: 'human' });
      await updateSupervision(db, 'CLI-0007', { mode: 'auto' });
      assert.equal(await scheduled(db, 'CLI-0007'), undefined);
      await message(db, 'CLI-0008');
      const guarded = await scheduled(db, 'CLI-0008');
      await createFollowupService(db, { ...models, audit: async () => false }).process(guarded.id);
      assert.equal((await status(db, guarded.id)).reason, 'guard');
      await message(db, 'CLI-0009');
      const refused = await scheduled(db, 'CLI-0009');
      await createFollowupService(db, {
        ...models,
        decide: async () => ({ eligible: false, reason: 'refused', message: '' }),
      }).process(refused.id);
      assert.equal((await status(db, refused.id)).reason, 'refused');
      assert.equal(
        (await db.query("SELECT followup_refused FROM conversations WHERE customer_id='CLI-0009'"))
          .rows[0].followup_refused,
        true,
      );
      // New message during generation cancels the draft without blocking the client.
      await message(db, 'CLI-0010');
      const raced = await scheduled(db, 'CLI-0010');
      const racing = createFollowupService(db, {
        ...models,
        decide: async () => {
          await message(db, 'CLI-0010', new Date());
          return models.decide('');
        },
      });
      assert.equal(await racing.process(raced.id), null);
      assert.equal((await status(db, raced.id)).status, 'cancelled');
      // Cart mutation during model work invalidates the draft even without a new message.
      await message(db, 'CLI-0011');
      const changed = await scheduled(db, 'CLI-0011');
      await createFollowupService(db, {
        ...models,
        decide: async () => {
          await setCartItem(db, 'CLI-0011', { ref: 'REF-0006', quantity: 2 });
          return models.decide('');
        },
      }).process(changed.id);
      assert.equal((await status(db, changed.id)).reason, 'cart_changed');
      for (const [customer, action] of [
        ['CLI-0013', 'human'],
        ['CLI-0014', 'order'],
      ] as const) {
        await message(db, customer);
        const during = await scheduled(db, customer);
        await createFollowupService(db, {
          ...models,
          decide: async () => {
            if (action === 'human') await updateSupervision(db, customer, { mode: 'human' });
            else {
              const q = await prepareCheckout(db, customer, delivery);
              await confirmCheckout(db, customer, { quoteId: q.id, confirmed: true });
            }
            return models.decide('');
          },
        }).process(during.id);
        assert.equal((await status(db, during.id)).status, 'cancelled');
      }
      // Attribution outside 24h is ignored.
      await message(db, 'CLI-0012');
      const old = await scheduled(db, 'CLI-0012');
      await service.process(old.id);
      await db.query("UPDATE followups SET sent_at=now()-interval '25 hours' WHERE id=$1", [
        old.id,
      ]);
      await message(db, 'CLI-0012', new Date());
      assert.equal((await status(db, old.id)).response_at, null);
    }),
);

test(
  'Redis/BullMQ: pending job survives worker restart and produces only one durable message',
  { skip: !process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL },
  async () =>
    fixture(async (db) => {
      const queueName = `test-followups-${randomUUID()}`;
      let attempts = 0;
      const transient: FollowupModels = {
        ...models,
        decide: async () => {
          if (attempts++ === 0) throw new Error('simulated-provider-secret');
          return models.decide('');
        },
      };
      await message(db, 'CLI-0020', new Date());
      let running = await startFollowupWorker({
        db,
        redisUrl: process.env.TEST_REDIS_URL!,
        models: transient,
        delayMs: 2500,
        queueName,
        reconcileMs: 200,
      });
      try {
        const row = (await db.query("SELECT * FROM followups WHERE customer_id='CLI-0020'"))
          .rows[0];
        assert.equal(await (await running.queue.getJob(row.id))!.getState(), 'delayed');
        await running.close();
        running = await startFollowupWorker({
          db,
          redisUrl: process.env.TEST_REDIS_URL!,
          models: transient,
          delayMs: 2500,
          queueName,
          reconcileMs: 200,
        });
        const deadline = Date.now() + 15000;
        while ((await status(db, row.id)).status === 'pending' && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal((await status(db, row.id)).status, 'sent');
        assert.equal(attempts, 2);
        const completedJob = await running.queue.getJob(row.id);
        assert.equal(completedJob?.failedReason, 'FOLLOWUP_PROCESSING_FAILED');
        assert.equal(JSON.stringify(completedJob).includes('simulated-provider-secret'), false);
        await running.reconcile();
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM chat_messages WHERE customer_id='CLI-0020' AND role='assistant'",
            )
          ).rows[0].n,
          1,
        );
        await running.worker.close();
        await running.queue.obliterate({ force: true });
      } finally {
        await running.close();
      }
    }),
);
