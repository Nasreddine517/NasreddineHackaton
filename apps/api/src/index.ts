import { readConfig } from '../../../packages/core/src/config.js';
import { createConnections } from '../../../packages/core/src/connections.js';
import { createApp } from './app.js';

const config = readConfig();
const app = await createApp(createConnections(config), config.LOG_LEVEL);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
await app.listen({ port: config.API_PORT, host: config.API_HOST });
