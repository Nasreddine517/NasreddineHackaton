import { readConfig } from '../../../packages/core/src/config.js';
import { createConnections } from '../../../packages/core/src/connections.js';
import { createAgentModels } from '../../../packages/core/src/agents/models.js';
import { startFollowupWorker } from '../../../packages/core/src/followup-worker.js';

const config = readConfig();
const connections = createConnections(config);
await connections.db.query('SELECT 1');
const models = config.LLM_API_KEY && config.AZURE_OPENAI_API_KEY ? createAgentModels(config) : null;
const followups = models
  ? await startFollowupWorker({
      db: connections.db,
      redisUrl: config.REDIS_URL,
      models: { decide: models.followup, audit: models.audit },
      delayMs: config.FOLLOWUP_DELAY_MS,
    })
  : null;
async function heartbeat() {
  await connections.redis.set('kenza:worker:heartbeat', Date.now().toString(), 'EX', 45);
}
await heartbeat();
console.info(
  followups
    ? 'Kenza worker ready: durable follow-ups enabled.'
    : 'Kenza worker ready: models missing, follow-ups disabled.',
);
// This is service health reporting, not a scheduler for commercial follow-ups.
const timer = setInterval(() => {
  void heartbeat().catch(() => console.error('Worker heartbeat unavailable.'));
}, 15000);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    clearInterval(timer);
    void (async () => {
      await followups?.close();
      await connections.close();
      process.exit(0);
    })();
  });
}
