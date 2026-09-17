import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://kenza:kenza_local_only@localhost:15432/kenza'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_HOST: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  FOLLOWUP_DELAY_MS: z.coerce.number().int().positive().default(1_800_000),
  DEMO_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  LLM_URL: z.string().default(''),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default(''),
  AZURE_OPENAI_ENDPOINT: z.string().default(''),
  AZURE_OPENAI_API_KEY: z.string().default(''),
  AZURE_OPENAI_API_VERSION: z.string().default('2024-12-01-preview'),
  AZURE_OPENAI_DEPLOYMENT_NAME: z.string().default('gpt-4.1'),
  AZURE_OPENAI_MAX_TOKENS: z.coerce.number().int().min(1).max(16384).default(16384),
  EMBEDDING_MODEL: z.string().default('embedder-small-3'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().min(1).max(65536).default(512),
  EMBEDDING_URL: z.string().default(''),
  EMBEDDING_API_KEY: z.string().default(''),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Do not put supplied values (URLs may include passwords) in errors.
    throw new Error(
      `Invalid configuration fields: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  }
  const config = parsed.data;
  if (!config.DEMO_MODE && config.FOLLOWUP_DELAY_MS !== 1_800_000) {
    throw new Error('FOLLOWUP_DELAY_MS must be 1800000 outside DEMO_MODE.');
  }
  const llmValues = [config.LLM_URL, config.LLM_API_KEY, config.LLM_MODEL];
  if (llmValues.some(Boolean) && !llmValues.every(Boolean)) {
    throw new Error('LLM_URL, LLM_API_KEY and LLM_MODEL must be configured together.');
  }
  if (config.AZURE_OPENAI_ENDPOINT || config.AZURE_OPENAI_API_KEY) {
    if (
      ![
        config.AZURE_OPENAI_ENDPOINT,
        config.AZURE_OPENAI_API_KEY,
        config.AZURE_OPENAI_API_VERSION,
        config.AZURE_OPENAI_DEPLOYMENT_NAME,
      ].every(Boolean)
    ) {
      throw new Error(
        'Azure endpoint, key, API version and deployment must be configured together.',
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}(?:-preview)?$/.test(config.AZURE_OPENAI_API_VERSION)) {
      throw new Error('AZURE_OPENAI_API_VERSION must be a dated API version.');
    }
  }
  if (Boolean(config.EMBEDDING_URL) !== Boolean(config.EMBEDDING_API_KEY)) {
    throw new Error('EMBEDDING_URL and EMBEDDING_API_KEY must be supplied together.');
  }
  for (const name of ['LLM_URL', 'AZURE_OPENAI_ENDPOINT', 'EMBEDDING_URL'] as const) {
    if (!config[name]) continue;
    try {
      const url = new URL(config[name]);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
        throw new Error();
    } catch {
      throw new Error(`${name} must be an HTTPS base URL without credentials, query or fragment.`);
    }
  }
  return config;
}
