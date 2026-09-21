/**
 * Can a chosen gladiator actually take the field? An API-key provider needs
 * its key; a subscription provider needs its CLI installed and signed in.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getProvider } from './models.js';

const binCache = new Map<string, boolean>();

export function hasBinary(bin: string): boolean {
  const cached = binCache.get(bin);
  if (cached !== undefined) return cached;
  let found = false;
  try {
    execFileSync('/usr/bin/env', ['which', bin], { stdio: 'ignore' });
    found = true;
  } catch {
    found = false;
  }
  binCache.set(bin, found);
  return found;
}

/** Has this CLI been signed in at least once? */
function cliSignedIn(providerId: string): boolean {
  const home = homedir();
  if (providerId === 'claude-cli') {
    return existsSync(join(home, '.claude')) || existsSync(join(home, '.claude.json'));
  }
  if (providerId === 'codex-cli') {
    return existsSync(join(home, '.codex', 'auth.json'));
  }
  return true;
}

export interface ProviderState {
  ready: boolean;
  hint: string;
}

export function providerState(providerId: string): ProviderState {
  const p = getProvider(providerId);

  if (p.backend === 'cli') {
    if (!hasBinary(p.bin!)) return { ready: false, hint: `install the \`${p.bin}\` CLI` };
    if (!cliSignedIn(p.id)) return { ready: false, hint: `run \`${p.bin}\` once and sign in` };
    return { ready: true, hint: 'signed in — no API key needed' };
  }

  if (p.id === 'compatible') {
    if (!process.env[p.baseUrlEnv!]) return { ready: false, hint: `set ${p.baseUrlEnv}` };
    return { ready: true, hint: process.env[p.baseUrlEnv!]! };
  }

  if (!p.envKey) return { ready: true, hint: p.note };

  const key = process.env[p.envKey];
  if (key && key.length > 0) return { ready: true, hint: 'key found' };
  return { ready: false, hint: `set ${p.envKey}` };
}

/** What is stopping this fight from starting? Empty means nothing is. */
export function blockers(providers: string[]): string[] {
  const out: string[] = [];
  for (const id of [...new Set(providers)]) {
    const state = providerState(id);
    if (!state.ready) out.push(`${getProvider(id).label}: ${state.hint}`);
  }
  return out;
}
