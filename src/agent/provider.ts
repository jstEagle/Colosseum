import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

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

/** Which env var must be present for a given provider. */
export function envKeyFor(provider: string): string {
  switch (provider) {
    case 'anthropic':
      return 'ANTHROPIC_API_KEY';
    case 'openai':
      return 'OPENAI_API_KEY';
    case 'openrouter':
    default:
      return 'OPENROUTER_API_KEY';
  }
}
