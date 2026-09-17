import OpenAI, { AzureOpenAI } from 'openai';
import type { readConfig } from '../config.js';

export type ModelConfig = ReturnType<typeof readConfig>;
type ClientOptions = { fetch?: typeof fetch };

// No fallback to a public provider: every client uses the organizer's configured endpoint.
// Disable SDK logging so headers, requests and response bodies cannot leak into diagnostics.
const options = { timeout: 30_000, maxRetries: 0, logLevel: 'off' as const };

export function createPrimaryClient(config: ModelConfig, override: ClientOptions = {}) {
  if (!config.LLM_URL || !config.LLM_API_KEY || !config.LLM_MODEL)
    throw new Error('Primary model is not configured.');
  return new OpenAI({
    ...options,
    ...override,
    baseURL: config.LLM_URL.replace(/\/$/, ''),
    apiKey: config.LLM_API_KEY,
  });
}

export function createAzureClient(config: ModelConfig, override: ClientOptions = {}) {
  if (!config.AZURE_OPENAI_ENDPOINT || !config.AZURE_OPENAI_API_KEY)
    throw new Error('Azure model is not configured.');
  return new AzureOpenAI({
    ...options,
    ...override,
    endpoint: config.AZURE_OPENAI_ENDPOINT.replace(/\/$/, ''),
    apiKey: config.AZURE_OPENAI_API_KEY,
    apiVersion: config.AZURE_OPENAI_API_VERSION,
    deployment: config.AZURE_OPENAI_DEPLOYMENT_NAME,
  });
}

export function createEmbeddingClient(config: ModelConfig, override: ClientOptions = {}) {
  const baseURL = config.EMBEDDING_URL || config.LLM_URL;
  const apiKey = config.EMBEDDING_API_KEY || config.LLM_API_KEY;
  if (!baseURL || !apiKey || !config.EMBEDDING_MODEL)
    throw new Error('Embedding model is not configured.');
  return new OpenAI({ ...options, ...override, baseURL: baseURL.replace(/\/$/, ''), apiKey });
}

export function boundedAzureTokens(config: ModelConfig, requested: number) {
  if (!Number.isInteger(requested) || requested <= 0)
    throw new Error('Token budget must be a positive integer.');
  return Math.min(requested, config.AZURE_OPENAI_MAX_TOKENS);
}

/** Deliberately exclude upstream messages, URLs, headers and request/response bodies. */
export function safeModelFailure(error: unknown) {
  if (error instanceof OpenAI.APIError) {
    const publicCodes = new Set([
      'invalid_api_key',
      'invalid_request_error',
      'model_not_found',
      'DeploymentNotFound',
      'ResourceNotFound',
      'OperationNotSupported',
      'unsupported_parameter',
      'unsupported_value',
      'insufficient_quota',
      'rate_limit_exceeded',
      'content_filter',
    ]);
    return {
      ok: false,
      status: error.status ?? null,
      code:
        typeof error.code === 'string' && publicCodes.has(error.code)
          ? error.code
          : 'UPSTREAM_ERROR',
    };
  }
  return { ok: false, status: null, code: 'CLIENT_OR_CONNECTION_ERROR' };
}
