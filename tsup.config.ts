import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    api: 'apps/api/src/index.ts',
    worker: 'apps/worker/src/index.ts',
    db: 'packages/core/src/db/cli.ts',
    'check-models': 'scripts/check-models.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist/server',
  sourcemap: true,
  clean: true,
});
