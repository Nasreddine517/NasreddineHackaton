import { readConfig } from '../config.js';
import pg from 'pg';
import { migrate } from './migrate.js';
import { seed } from './seed.js';

const config = readConfig();
const pool = new pg.Pool({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  if (process.argv[2] === 'migrate') await migrate(pool);
  else if (process.argv[2] === 'seed') await seed(pool);
  else throw new Error('Usage: db migrate | seed');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Database operation failed.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
