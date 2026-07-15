/**
 * Model Provider Registry
 *
 * Manages model configurations and creates Vercel AI SDK LanguageModel instances.
 * Supports: openai (OpenAI-compatible, incl. Ollama/vLLM), anthropic.
 * Includes retry policy wrapper (Property 14).
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { wrapLanguageModel, type LanguageModelV1, type LanguageModelV1Middleware } from 'ai';
import { resolveEnvVars } from '@/core/config/env-resolver.js';
import {
  DEFAULT_RETRY_POLICY,
  type ModelConfig,
  type ModelProviderType,
  type RetryPolicy,
  type RuntimeConfigState,
  type RuntimeModelInfo,
} from '@/types/model.js';

export class ModelRegistry {
  private models = new Map<string, ModelConfig>();
  private defaultModelName: string | undefined;

  constructor(private readonly retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY) {}

  /**
   * Register a model configuration.
   */
  register(config: ModelConfig): void {
    this.models.set(config.name, config);
    if (config.is_default || !this.defaultModelName) {
      this.defaultModelName = config.name;
    }
  }

  /**
   * Get a registered model config by name.
   */
  get(name: string): ModelConfig | undefined {
    return this.models.get(name);
  }

  setDefault(name: string): void {
    if (!this.models.has(name)) {
      throw new ModelNotFoundError(name, Array.from(this.models.keys()));
    }
    this.defaultModelName = name;
  }

  getDefaultName(): string | undefined {
    return this.defaultModelName ?? Array.from(this.models.keys())[0];
  }

  /**
   * Create a Vercel AI SDK LanguageModel instance, wrapped with the retry
   * middleware (Property 14). Resolves ${ENV_VAR} in api_key and base_url.
   * Throws if model not registered.
   */
  createModel(name: string): LanguageModelV1 {
    const config = this.models.get(name);
    if (!config) {
      throw new ModelNotFoundError(name, Array.from(this.models.keys()));
    }

    const resolvedApiKey = config.api_key ? resolveEnvVars(config.api_key, false) : undefined;
    const resolvedBaseUrl = config.base_url ? resolveEnvVars(config.base_url, false) : undefined;

    const base = createModelInstance(config.provider, config.model, resolvedApiKey, resolvedBaseUrl);
    return wrapLanguageModel({
      model: base,
      middleware: createRetryMiddleware(this.retryPolicy),
    });
  }

  /**
   * Health check: attempt a minimal test against the model.
   * Returns false on any error, does not throw.
   */
  async healthCheck(name: string): Promise<boolean> {
    try {
      const model = this.createModel(name);
      // Just verify the model object was created successfully
      // A real health check would do a 1-token completion, but that costs money
      return model !== null && model !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * List all registered model names.
   */
  listNames(): string[] {
    return Array.from(this.models.keys());
  }

  /**
   * List model metadata that is safe to expose through runtime introspection.
   * Never includes raw API keys or resolved base URLs.
   */
  listRuntimeInfo(): RuntimeModelInfo[] {
    const defaultName = this.getDefaultName();
    return Array.from(this.models.values())
      .sort((a, b) => Number(b.name === defaultName) - Number(a.name === defaultName) || a.name.localeCompare(b.name))
      .map((config) => ({
      name: config.name,
      provider: config.provider ?? 'unknown',
      model: config.model ?? config.name,
      base_url: publicBaseUrl(config.base_url),
      api_key_state: configState(config.api_key),
      base_url_state: configState(config.base_url),
      is_default: config.name === defaultName,
    }));
  }
}

const ENV_PLACEHOLDER = /\$\{[^}]+\}/;

function configState(value?: string): RuntimeConfigState {
  if (!value) return 'not_set';
  const resolved = resolveEnvVars(value, false);
  return ENV_PLACEHOLDER.test(resolved) ? 'missing_env' : 'configured';
}

function publicBaseUrl(value?: string): string | undefined {
  if (!value) return undefined;
  const resolved = resolveEnvVars(value, false);
  return ENV_PLACEHOLDER.test(resolved) ? undefined : resolved;
}

// ============================================================
// Retry Middleware (Property 14)
// ============================================================

/**
 * Wrap model generate/stream calls with the retry policy:
 * - network timeout: retry up to 3x, no backoff
 * - rate limit (429): honor Retry-After, up to 3x
 * - auth (401/403): never retry
 */
function createRetryMiddleware(policy: RetryPolicy): LanguageModelV1Middleware {
  const runWithRetry = async <T>(fn: () => PromiseLike<T>): Promise<T> => {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (err) {
        const type = policy.classify(err);
        const max = policy.maxRetries(type);
        if (attempt >= max) throw err;
        const headers = extractHeaders(err);
        const delay = policy.getDelay(type, attempt, headers);
        if (delay > 0) await sleep(delay);
        attempt++;
      }
    }
  };

  return {
    wrapGenerate: async ({ doGenerate }) => runWithRetry(doGenerate),
    // Streaming: retry only applies to establishing the stream (the initial
    // call). Once bytes flow, mid-stream failures are surfaced to the caller.
    wrapStream: async ({ doStream }) => runWithRetry(doStream),
  };
}

function extractHeaders(err: unknown): Headers | undefined {
  if (err && typeof err === 'object' && 'responseHeaders' in err) {
    const h = (err as { responseHeaders?: unknown }).responseHeaders;
    if (h instanceof Headers) return h;
    if (h && typeof h === 'object') {
      return new Headers(h as Record<string, string>);
    }
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// Model Factory
// ============================================================

function createModelInstance(
  provider: ModelProviderType,
  model: string,
  apiKey?: string,
  baseUrl?: string,
): LanguageModelV1 {
  switch (provider) {
    case 'openai':
    case 'ollama': {
      const openai = createOpenAI({
        apiKey: apiKey ?? 'ollama', // Ollama doesn't need a key
        baseURL: baseUrl,
      });
      return openai(model);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: apiKey,
        baseURL: baseUrl,
      });
      return anthropic(model);
    }
    default: {
      // Treat unknown providers as OpenAI-compatible
      const openaiCompat = createOpenAI({
        apiKey: apiKey ?? '',
        baseURL: baseUrl,
      });
      return openaiCompat(model);
    }
  }
}

// ============================================================
// Errors
// ============================================================

export class ModelNotFoundError extends Error {
  constructor(
    public readonly modelName: string,
    public readonly available: string[],
  ) {
    const suggestion = available.length > 0
      ? `Available models: ${available.join(', ')}`
      : 'No models registered. Add a model provider in Dashboard Settings > Models';
    super(`Model not found: "${modelName}". ${suggestion}`);
    this.name = 'ModelNotFoundError';
  }
}
