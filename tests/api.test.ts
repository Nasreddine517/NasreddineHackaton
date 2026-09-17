import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../apps/api/src/app.js';
import type { createConnections } from '../packages/core/src/connections.js';

test('readiness reports dependency failures and does not expose exception content', async () => {
  const connections = {
    db: {
      query: async () => {
        throw new Error('postgresql://user:private-password@host/db');
      },
    },
    redis: { ping: async () => 'PONG', get: async () => null },
    close: async () => {},
  } as unknown as ReturnType<typeof createConnections>;
  const app = await createApp(connections, 'silent');
  try {
    assert.equal((await app.inject('/api/health/live')).statusCode, 200);
    const ready = await app.inject('/api/health/ready');
    assert.equal(ready.statusCode, 503);
    assert.equal(ready.json().services.postgres, false);
    assert.equal(ready.json().services.redis, true);
    assert.equal(ready.body.includes('private-password'), false);
    assert.equal((await app.inject('/api/system')).json().chatEnabled, false);
  } finally {
    await app.close();
  }
});
