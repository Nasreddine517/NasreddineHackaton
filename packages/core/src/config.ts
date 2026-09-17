import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://kenza:kenza_local_only@localhost:5432/kenza'),
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
  return config;
}
