import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../packages/core/src/config.js';

// Opt-in: all integration writes use unique disposable schemas/queue names.
const config = readConfig();
const tests = readdirSync('tests')
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => `tests/${name}`);
const result = spawnSync(
  process.execPath,
  [fileURLToPath(import.meta.resolve('tsx/cli')), '--test', ...tests],
  {
    env: {
      ...process.env,
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL || config.DATABASE_URL,
      TEST_REDIS_URL: process.env.TEST_REDIS_URL || config.REDIS_URL,
    },
    stdio: 'inherit',
  },
);
process.exit(result.status ?? 1);
