import { readConfig } from '../../../packages/core/src/config.js';
import { createConnections } from '../../../packages/core/src/connections.js';
import { createApp } from './app.js';
import { createAgentModels } from '../../../packages/core/src/agents/models.js';

const config = readConfig();
const models =
  config.LLM_API_KEY && config.AZURE_OPENAI_API_KEY ? createAgentModels(config) : undefined;
const app = await createApp(createConnections(config), config.LOG_LEVEL, config, models);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
await app.listen({ port: config.API_PORT, host: config.API_HOST });
