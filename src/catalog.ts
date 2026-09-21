/**
 * The live model catalogue.
 *
 * Once a key is in hand, the provider itself can say which models it offers,
 * which beats any list hard-coded here. The curated list in `models.ts` stays
 * as the fallback for providers that cannot be asked, or when the network is
 * having a bad day.
 */
import { MODELS, getProvider } from './models.js';

const cache = new Map<string, string[]>();

function endpointFor(providerId: string): { url: string; key?: string } | null {
  const p = getProvider(providerId);
  const key = p.envKey ? process.env[p.envKey] : undefined;
  switch (providerId) {
    case 'openrouter':
      return { url: 'https://openrouter.ai/api/v1/models', key };
    case 'openai':
      return { url: 'https://api.openai.com/v1/models', key };
    case 'compatible': {
      const base = process.env[p.baseUrlEnv ?? ''];
      return base ? { url: `${base.replace(/\/$/, '')}/models`, key } : null;
    }
    case 'ollama':
      return { url: `${(p.baseUrl ?? '').replace(/\/$/, '')}/models` };
    default:
      // Anthropic's model list needs a different header shape and changes
      // rarely; the curated list is fine there.
      return null;
  }
}

/**
 * Ask a provider what it offers. Resolves to the curated list rather than
 * throwing: a setup screen that cannot offer a list is worse than one
 * offering a short one.
 */
export async function fetchModels(providerId: string): Promise<{ models: string[]; live: boolean }> {
  const cached = cache.get(providerId);
  if (cached) return { models: cached, live: true };

  const ep = endpointFor(providerId);
  const fallback = MODELS[providerId] ?? [];
  if (!ep) return { models: fallback, live: false };

  try {
    const res = await fetch(ep.url, {
      headers: ep.key ? { Authorization: `Bearer ${ep.key}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { models: fallback, live: false };
    const body: any = await res.json();
    const ids: string[] = (body?.data ?? [])
      .map((m: any) => m?.id)
      .filter((id: any): id is string => typeof id === 'string');
    if (!ids.length) return { models: fallback, live: false };
    ids.sort();
    cache.set(providerId, ids);
    return { models: ids, live: true };
  } catch {
    return { models: fallback, live: false };
  }
}

/**
 * Where a key can be checked. Not the same as the catalogue endpoint:
 * OpenRouter serves its model list to anyone, so asking for it would accept
 * any nonsense a person pasted.
 */
function verifyEndpointFor(providerId: string, key: string): { url: string; headers: Record<string, string> } | null {
  const p = getProvider(providerId);
  switch (providerId) {
    case 'openrouter':
      return { url: 'https://openrouter.ai/api/v1/key', headers: { Authorization: `Bearer ${key}` } };
    case 'openai':
      return { url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${key}` } };
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/models',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      };
    case 'compatible': {
      const base = process.env[p.baseUrlEnv ?? ''];
      return base
        ? { url: `${base.replace(/\/$/, '')}/models`, headers: { Authorization: `Bearer ${key}` } }
        : null;
    }
    default:
      return null;
  }
}

/**
 * Is this key any good? The answer has to come from the provider, and only
 * an outright rejection is treated as failure: being offline is not a reason
 * to refuse someone's key.
 */
export async function verifyKey(providerId: string, key: string): Promise<string | null> {
  const ep = verifyEndpointFor(providerId, key);
  if (!ep) return null; // nothing to check against; take the key on trust

  try {
    const res = await fetch(ep.url, { headers: ep.headers, signal: AbortSignal.timeout(10_000) });
    if (res.status === 401 || res.status === 403) {
      return 'That key was rejected by the provider. Check it and paste again.';
    }
    return null;
  } catch {
    return null; // offline: no reason to block the fight
  }
}

/** Narrow a long catalogue with a typed query. */
export function filterModels(models: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return models;
  const terms = q.split(/\s+/);
  return models.filter((m) => {
    const lower = m.toLowerCase();
    return terms.every((t) => lower.includes(t));
  });
}
