import { readConfig } from '../packages/core/src/config.js';
import {
  boundedAzureTokens,
  createAzureClient,
  createEmbeddingClient,
  createPrimaryClient,
  safeModelFailure,
} from '../packages/core/src/llm/clients.js';

// Opt-in real network checks. Only synthetic text is sent; no customer or catalogue data.
// A single bounded request per service, no automatic retries or provider substitutions.
const config = readConfig();
let failed = false;
for (const target of ['primary', 'azure', 'embedding'] as const) {
  try {
    if (target === 'embedding') {
      const result = await createEmbeddingClient(config).embeddings.create({
        model: config.EMBEDDING_MODEL,
        input: 'robe bleue en coton',
        dimensions: config.EMBEDDING_DIMENSIONS,
        encoding_format: 'float',
      });
      const vector = result.data[0]?.embedding;
      const valid =
        Array.isArray(vector) &&
        vector.length === config.EMBEDDING_DIMENSIONS &&
        vector.every(Number.isFinite);
      console.log(JSON.stringify({ target, ok: valid, dimensions: vector?.length ?? 0 }));
      failed ||= !valid;
    } else {
      const client = target === 'primary' ? createPrimaryClient(config) : createAzureClient(config);
      const result = await client.chat.completions.create({
        model: target === 'primary' ? config.LLM_MODEL : config.AZURE_OPENAI_DEPLOYMENT_NAME,
        messages: [{ role: 'user', content: 'Réponds uniquement OK.' }],
        ...(target === 'primary'
          ? { max_completion_tokens: 256 }
          : { max_tokens: boundedAzureTokens(config, 32) }),
      });
      const valid = Boolean(result.choices[0]?.message.content?.trim());
      console.log(
        JSON.stringify({
          target,
          ok: valid,
          receivedText: valid,
          finishReason: result.choices[0]?.finish_reason ?? null,
        }),
      );
      failed ||= !valid;
    }
  } catch (error) {
    failed = true;
    console.log(JSON.stringify({ target, ...safeModelFailure(error) }));
  }
}
process.exitCode = failed ? 1 : 0;
