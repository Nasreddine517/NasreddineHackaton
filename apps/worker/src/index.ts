import { readConfig } from '../../../packages/core/src/config.js';
import { createConnections } from '../../../packages/core/src/connections.js';

const connections = createConnections(readConfig());
await connections.db.query('SELECT 1');
async function heartbeat() {
  await connections.redis.set('kenza:worker:heartbeat', Date.now().toString(), 'EX', 45);
}
await heartbeat();
console.info('Kenza worker ready. Follow-up processing will be enabled in lot 6.');
// This is service health reporting, not a scheduler for commercial follow-ups.
const timer = setInterval(() => {
  void heartbeat().catch(() => console.error('Worker heartbeat unavailable.'));
}, 15000);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    clearInterval(timer);
    void connections.close().then(() => process.exit(0));
  });
}
