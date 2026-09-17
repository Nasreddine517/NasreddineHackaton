import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../packages/core/src/config.js';
import {
  boundedAzureTokens,
  createAzureClient,
  createEmbeddingClient,
  createPrimaryClient,
  safeModelFailure,
} from '../packages/core/src/llm/clients.js';

const config = readConfig({
  LLM_URL: 'https://primary.example/openai/v1',
  LLM_API_KEY: 'test-primary-key',
  LLM_MODEL: 'gpt-5.5',
  AZURE_OPENAI_ENDPOINT: 'https://secondary.example',
  AZURE_OPENAI_API_KEY: 'test-azure-key',
  AZURE_OPENAI_API_VERSION: '2024-12-01-preview',
  AZURE_OPENAI_DEPLOYMENT_NAME: 'gpt-4.1',
});
const response = () =>
  new Response(
    JSON.stringify({
      id: 'test',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    }),
    { headers: { 'content-type': 'application/json' } },
  );

test('primary retains the exact v1 base path and bearer authentication', async () => {
  const mock: typeof fetch = async (input, init) => {
    assert.equal(String(input), 'https://primary.example/openai/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-primary-key');
    assert.equal(JSON.parse(String(init?.body)).model, 'gpt-5.5');
    return response();
  };
  await createPrimaryClient(config, { fetch: mock }).chat.completions.create({
    model: config.LLM_MODEL,
    messages: [{ role: 'user', content: 'Test' }],
  });
});

test('Azure uses the deployment path, dated version and separate API key', async () => {
  const mock: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://secondary.example');
    assert.equal(url.pathname, '/openai/deployments/gpt-4.1/chat/completions');
    assert.equal(url.searchParams.get('api-version'), '2024-12-01-preview');
    assert.equal(new Headers(init?.headers).get('api-key'), 'test-azure-key');
    assert.notEqual(new Headers(init?.headers).get('authorization'), 'Bearer test-primary-key');
    return response();
  };
  await createAzureClient(config, { fetch: mock }).chat.completions.create({
    model: config.AZURE_OPENAI_DEPLOYMENT_NAME,
    messages: [{ role: 'user', content: 'Test' }],
  });
  assert.equal(boundedAzureTokens(config, 20000), 16384);
  assert.equal(boundedAzureTokens(config, 32), 32);
});

test('embeddings retain the supplied deployment alias and dimensions', async () => {
  const mock: typeof fetch = async (input, init) => {
    assert.equal(String(input), 'https://primary.example/openai/v1/embeddings');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'embedder-small-3');
    assert.equal(body.dimensions, 512);
    return new Response(JSON.stringify({ data: [{ index: 0, embedding: Array(512).fill(0) }] }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  const result = await createEmbeddingClient(config, { fetch: mock }).embeddings.create({
    model: config.EMBEDDING_MODEL,
    dimensions: config.EMBEDDING_DIMENSIONS,
    input: 'test',
    encoding_format: 'float',
  });
  assert.equal(result.data[0]?.embedding.length, 512);
});

test('diagnostics never include raw error messages with secrets', () => {
  const result = safeModelFailure(new Error('private upstream URL and key'));
  assert.equal(JSON.stringify(result).includes('private upstream'), false);
});

test('partial Azure and unsafe endpoint configurations fail without echoing input', () => {
  assert.throws(() => readConfig({ AZURE_OPENAI_API_KEY: 'test-key' }));
  assert.throws(
    () =>
      readConfig({
        LLM_URL: 'https://user:secret@example.test/v1',
        LLM_API_KEY: 'test-key',
        LLM_MODEL: 'gpt-5.5',
      }),
    (e: unknown) => e instanceof Error && !e.message.includes('secret'),
  );
});
