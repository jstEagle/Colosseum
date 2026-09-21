import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { getProvider } from '../models.js';

export interface ResolvedModel {
  model: LanguageModel;
  providerOptions: Record<string, Record<string, unknown>>;
}

const REASONING_BUDGET: Record<string, number> = {
  low: 2048,
  medium: 6144,
  high: 12288,
};

/**
 * Turn a provider id + model id + reasoning level into a ready-to-use
 * language model plus the provider-specific options that enable reasoning.
 * Only the key-based backends reach this: subscription CLIs resolve nothing,
 * because the CLI itself decides which model it talks to.
 */
export function resolveModel(
  provider: string,
  modelId: string,
  reasoning: string,
): ResolvedModel {
  const providerOptions: Record<string, Record<string, unknown>> = {};

  switch (provider) {
    case 'anthropic': {
      const anthropic = createAnthropic({});
      if (reasoning !== 'none') {
        providerOptions.anthropic = {
          thinking: {
            type: 'enabled',
            budgetTokens: REASONING_BUDGET[reasoning] ?? 6144,
          },
        };
      }
      return { model: anthropic(modelId), providerOptions };
    }
    case 'openai': {
      const openai = createOpenAI({});
      if (reasoning !== 'none') {
        providerOptions.openai = { reasoningEffort: reasoning };
      }
      return { model: openai(modelId), providerOptions };
    }
    case 'compatible':
    case 'ollama': {
      // Anything that speaks the OpenAI wire format: Gemini's compatible
      // endpoint, Groq, Together, vLLM, LM Studio, Ollama, your own gateway.
      const info = getProvider(provider);
      const baseURL =
        info.baseUrl ??
        (info.baseUrlEnv ? process.env[info.baseUrlEnv] : undefined) ??
        'http://localhost:11434/v1';
      const apiKey = (info.envKey ? process.env[info.envKey] : undefined) ?? 'not-needed';
      const client = createOpenAI({ baseURL, apiKey });
      if (reasoning !== 'none' && provider === 'compatible') {
        providerOptions.openai = { reasoningEffort: reasoning };
      }
      return { model: client(modelId), providerOptions };
    }
    case 'openrouter':
    default: {
      const openrouter = createOpenRouter({});
      if (reasoning !== 'none') {
        providerOptions.openrouter = { reasoning: { effort: reasoning } };
      }
      return { model: openrouter(modelId), providerOptions };
    }
  }
}

/** Which env var must be present for a given provider, if any. */
export function envKeyFor(provider: string): string | null {
  return getProvider(provider).envKey ?? null;
}

/**
 * Can this gladiator actually take the field? Subscription providers need
 * their CLI installed and signed in rather than a key.
 */
export function providerReady(provider: string): boolean {
  const info = getProvider(provider);
  if (info.backend === 'cli') return true; // checked separately, on PATH
  if (!info.envKey) return true; // local servers need nothing
  if (info.id === 'compatible' && !process.env[info.baseUrlEnv ?? '']) return false;
  const v = process.env[info.envKey];
  return typeof v === 'string' && v.length > 0;
}
