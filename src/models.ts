/**
 * Providers.
 *
 * Two kinds of backend can drive a gladiator:
 *
 *   'sdk' — an API-key provider spoken to through the Vercel AI SDK.
 *   'cli' — a coding agent you already pay for, driven headlessly through its
 *           own command line, so a Claude or Codex subscription fights without
 *           any API key at all.
 *
 * OpenRouter stays the default for the key-based path because one key reaches
 * every model. `compatible` covers anything else that speaks the OpenAI API.
 */

export type Backend = 'sdk' | 'cli';

export interface ProviderInfo {
  id: string;
  label: string;
  backend: Backend;
  /** Environment variable holding the key, when one is needed at all. */
  envKey?: string;
  /** Executable that must be on PATH for a CLI provider. */
  bin?: string;
  /** Base URL env var for OpenAI-compatible endpoints. */
  baseUrlEnv?: string;
  /** Fixed base URL for local servers. */
  baseUrl?: string;
  supportsReasoning: boolean;
  note: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    backend: 'sdk',
    envKey: 'OPENROUTER_API_KEY',
    supportsReasoning: true,
    note: 'one key, every model',
  },
  {
    id: 'claude-cli',
    label: 'Claude subscription (claude CLI)',
    backend: 'cli',
    bin: 'claude',
    supportsReasoning: false,
    note: 'uses your Claude plan login — no API key',
  },
  {
    id: 'codex-cli',
    label: 'Codex subscription (codex CLI)',
    backend: 'cli',
    bin: 'codex',
    supportsReasoning: true,
    note: 'uses your ChatGPT plan login — no API key',
  },
  {
    id: 'anthropic',
    label: 'Anthropic API',
    backend: 'sdk',
    envKey: 'ANTHROPIC_API_KEY',
    supportsReasoning: true,
    note: 'native Claude models',
  },
  {
    id: 'openai',
    label: 'OpenAI API',
    backend: 'sdk',
    envKey: 'OPENAI_API_KEY',
    supportsReasoning: true,
    note: 'native GPT / o-series',
  },
  {
    id: 'compatible',
    label: 'OpenAI-compatible endpoint',
    backend: 'sdk',
    envKey: 'COMPATIBLE_API_KEY',
    baseUrlEnv: 'COMPATIBLE_BASE_URL',
    supportsReasoning: true,
    note: 'Gemini, Groq, Together, vLLM… set COMPATIBLE_BASE_URL',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    backend: 'sdk',
    baseUrl: 'http://localhost:11434/v1',
    supportsReasoning: false,
    note: 'no key needed, runs on your machine',
  },
];

export function getProvider(id: string): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export function isCliProvider(id: string): boolean {
  return getProvider(id).backend === 'cli';
}

/**
 * Curated model ids per provider. Any other id can be typed by hand in the
 * setup screen, so this list is only a convenience.
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
  'claude-cli': ['default', 'opus', 'sonnet', 'haiku'],
  'codex-cli': ['default', 'gpt-5-codex', 'gpt-5', 'o4-mini'],
  anthropic: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
  openai: ['gpt-5', 'o4-mini', 'gpt-4.1'],
  compatible: ['gemini-2.5-pro', 'llama-3.3-70b-versatile'],
  ollama: ['qwen2.5-coder:14b', 'llama3.1:8b'],
};

export const REASONING_LEVELS = ['none', 'low', 'medium', 'high'] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export function defaultModel(provider: string): string {
  return MODELS[provider]?.[0] ?? '';
}
