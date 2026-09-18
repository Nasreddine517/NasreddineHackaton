import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import type pg from 'pg';
import { createFollowupService } from './agents/followup.js';
import type { FollowupModels } from './agents/models.js';
import { FOLLOWUP_CHANNEL, FOLLOWUP_QUEUE, reconcileFollowups } from './domain/followups.js';

export async function startFollowupWorker(options: {
  db: pg.Pool;
  redisUrl: string;
  models: FollowupModels;
  delayMs: number;
  queueName?: string;
  reconcileMs?: number;
}) {
  const { db } = options;
  const redis = new Redis(options.redisUrl, { maxRetriesPerRequest: null });
  redis.on('error', () => {});
  const queue = new Queue(options.queueName ?? FOLLOWUP_QUEUE, { connection: redis });
  const service = createFollowupService(db, options.models);
  const worker = new Worker(
    options.queueName ?? FOLLOWUP_QUEUE,
    async (job) => {
      try {
        const customerId = await service.process(job.data.id);
        if (customerId) {
          // The durable message is already committed. Pub/sub is only a wakeup;
          // reconnecting clients always load history from PostgreSQL.
          await redis.publish(FOLLOWUP_CHANNEL, JSON.stringify({ customerId })).catch(() => {});
        }
      } catch {
        // Never persist the provider's error body in Redis/BullMQ logs.
        throw new Error('FOLLOWUP_PROCESSING_FAILED');
      }
    },
    { connection: redis, concurrency: 2 },
  );
  worker.on('error', () => console.error('Follow-up worker unavailable.'));
  worker.on('failed', (job) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1))
      void db
        .query(
          "UPDATE followups SET status='failed',reason='technical' WHERE id=$1 AND status='pending'",
          [job.data.id],
        )
        .catch(() => console.error('Follow-up failure status unavailable.'));
  });
  let reconciling: Promise<void> | null = null;
  async function reconcile() {
    if (reconciling) return reconciling;
    reconciling = (async () => {
      const pending = await reconcileFollowups(db, options.delayMs);
      for (const row of pending) {
        const existing = await queue.getJob(row.id);
        const state = await existing?.getState();
        if (state === 'failed') {
          await db.query(
            "UPDATE followups SET status='failed',reason='technical' WHERE id=$1 AND status='pending'",
            [row.id],
          );
          continue;
        }
        if (state === 'completed') await existing!.remove();
        if (!existing || state === 'completed')
          await queue.add(
            'abandoned-cart',
            { id: row.id },
            {
              jobId: row.id,
              delay: Math.max(0, row.due_at.getTime() - Date.now()),
              attempts: 5,
              backoff: { type: 'exponential', delay: 2000 },
              removeOnComplete: { age: 86400, count: 1000 },
              removeOnFail: { age: 604800, count: 1000 },
            },
          );
      }
    })();
    try {
      await reconciling;
    } finally {
      reconciling = null;
    }
  }
  try {
    await worker.waitUntilReady();
    await reconcile();
  } catch (error) {
    await worker.close(true);
    await queue.close();
    redis.disconnect();
    throw error;
  }
  // Recovery/outbox pump only. The commercial deadline is held by PostgreSQL
  // and Redis delayed jobs, never by this process-local interval.
  const timer = setInterval(() => {
    void reconcile().catch(() => console.error('Follow-up reconciliation unavailable.'));
  }, options.reconcileMs ?? 5000);
  return {
    queue,
    worker,
    reconcile,
    close: async () => {
      clearInterval(timer);
      await reconciling?.catch(() => {});
      await worker.close();
      await queue.close();
      await redis.quit();
    },
  };
}
