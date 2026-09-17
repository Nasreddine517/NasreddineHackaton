import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../packages/core/src/config.js';

test('30-minute rule is enforced except in explicit demo mode', () => {
  assert.equal(readConfig({}).FOLLOWUP_DELAY_MS, 1800000);
  assert.throws(() => readConfig({ FOLLOWUP_DELAY_MS: '3000' }));
  assert.equal(
    readConfig({ DEMO_MODE: 'true', FOLLOWUP_DELAY_MS: '3000' }).FOLLOWUP_DELAY_MS,
    3000,
  );
});
test('partial LLM configuration fails without exposing a secret', () => {
  assert.throws(
    () => readConfig({ LLM_API_KEY: 'private-test-value' }),
    (e: unknown) => e instanceof Error && !e.message.includes('private-test-value'),
  );
});
