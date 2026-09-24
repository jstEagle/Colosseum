/**
 * Can a chosen gladiator actually take the field? An API-key provider needs
 * its key; a subscription provider needs its CLI installed and signed in.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getProvider } from './models.js';
import { readCodexAuth } from './agent/codex.js';
import { getSandbox, seatbeltAvailable, type SandboxMode } from './sandbox.js';

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
    try {
      readCodexAuth();
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

export interface ProviderState {
  ready: boolean;
  hint: string;
}

export function providerState(providerId: string): ProviderState {
  const p = getProvider(providerId);

  if (p.backend === 'dummy') return { ready: true, hint: p.note };

  if (p.backend === 'cli') {
    if (!seatbeltAvailable()) return { ready: false, hint: 'subscription CLIs are confined by Seatbelt: macOS only' };
    if (!hasBinary(p.bin!)) return { ready: false, hint: `install the \`${p.bin}\` CLI` };
    if (!cliSignedIn(p.id)) {
      return {
        ready: false,
        hint: p.id === 'codex-cli'
          ? 'run `codex -c cli_auth_credentials_store="file" login` with ChatGPT'
          : `run \`${p.bin}\` once and sign in`,
      };
    }
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

/**
 * Can this sandbox be stood up here? Every match runs inside one, so a
 * sandbox that cannot be built is a reason not to fight at all.
 */
export function sandboxState(mode: SandboxMode): ProviderState {
  if (mode === 'sealed') {
    if (!hasBinary('docker')) return { ready: false, hint: 'install Docker' };
    return { ready: true, hint: 'needs the Docker daemon running' };
  }
  if (!seatbeltAvailable()) return { ready: false, hint: 'macOS only — use the sealed arena' };
  return { ready: true, hint: 'ready' };
}

/** The sandbox to open the setup screen on: the first one that works here. */
export function defaultSandbox(): SandboxMode {
  return sandboxState('guarded').ready ? 'guarded' : 'sealed';
}

/** What is stopping this fight from starting? Empty means nothing is. */
export function blockers(providers: string[], sandbox?: SandboxMode): string[] {
  const out: string[] = [];
  for (const id of [...new Set(providers)]) {
    const state = providerState(id);
    if (!state.ready) out.push(`${getProvider(id).label}: ${state.hint}`);
  }
  if (sandbox) {
    const state = sandboxState(sandbox);
    if (!state.ready) out.push(`${getSandbox(sandbox).name}: ${state.hint}`);
  }
  return out;
}
