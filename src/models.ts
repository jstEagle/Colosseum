/**
 * Providers and a curated shortlist of models. OpenRouter is the default
 * because a single key reaches every provider. Any model id can still be
 * typed by hand in the setup screen, so this list is only a convenience.
 */

export interface ProviderInfo {
  id: string;
  label: string;
  /** Environment variable that holds the key for this provider. */
  envKey: string;
  /** Whether reasoning-effort selection is meaningful for this provider. */
  supportsReasoning: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'openrouter', label: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', supportsReasoning: true },
  { id: 'anthropic', label: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', supportsReasoning: true },
  { id: 'openai', label: 'OpenAI', envKey: 'OPENAI_API_KEY', supportsReasoning: true },
];

/**
 * Curated model ids per provider. For OpenRouter these are slugs; users may
 * type any other slug. Kept short and editable on purpose.
 */
export const MODELS: Record<string, string[]> = {
  openrouter: [
    'anthropic/claude-opus-4.1',
    'anthropic/claude-sonnet-4',
    'openai/gpt-5',
    'openai/o4-mini',
    'google/gemini-2.5-pro',
    'x-ai/grok-4',
    'deepseek/deepseek-r1',
    'meta-llama/llama-3.3-70b-instruct',
  ],
  anthropic: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
  openai: ['gpt-5', 'o4-mini', 'gpt-4.1'],
};

export const REASONING_LEVELS = ['none', 'low', 'medium', 'high'] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export function defaultModel(provider: string): string {
  return MODELS[provider]?.[0] ?? '';
}
