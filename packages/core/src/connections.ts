import pg from 'pg';
import Redis from 'ioredis';
import type { readConfig } from './config.js';

export function createConnections(config: ReturnType<typeof readConfig>) {
  const db = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 3000,
  });
  const redis = new Redis(config.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
  });
  // Connection failures are reported by readiness checks; never log credential-bearing URLs.
  redis.on('error', () => {});
  db.on('error', () => {});
  return {
    db,
    redis,
    close: async () => {
      redis.disconnect();
      await db.end();
    },
  };
}
