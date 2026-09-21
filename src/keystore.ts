/**
 * Where pasted API keys live.
 *
 * Keys go in `~/.colosseum/env`, not in the repository, so a key survives
 * between matches without ever being at risk of being committed. Anything
 * already in the environment wins, so `export OPENROUTER_API_KEY=…` and a
 * project `.env` both still take precedence over a stored key.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const KEY_FILE = join(homedir(), '.colosseum', 'env');

function parse(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

export function readStore(): Record<string, string> {
  if (!existsSync(KEY_FILE)) return {};
  try {
    return parse(readFileSync(KEY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** Fill in anything the environment has not already set. */
export function loadStoredKeys() {
  for (const [k, v] of Object.entries(readStore())) {
    if (!(k in process.env) && v) process.env[k] = v;
  }
}

/** Remember a key and make it live for this session immediately. */
export function saveKey(envKey: string, value: string): string {
  const store = readStore();
  store[envKey] = value;
  mkdirSync(dirname(KEY_FILE), { recursive: true });
  const body =
    '# Colosseum keys. Written by the setup screen; safe to edit or delete.\n' +
    Object.entries(store)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') +
    '\n';
  writeFileSync(KEY_FILE, body, { mode: 0o600 });
  try {
    chmodSync(KEY_FILE, 0o600);
  } catch {
    /* best effort on exotic filesystems */
  }
  process.env[envKey] = value;
  return KEY_FILE;
}

/**
 * Show enough of a key to recognise it, never enough to use it. Plain ASCII
 * on purpose: a bullet is an ambiguous-width character and wrecks the layout
 * in some terminals.
 */
export function maskKey(value: string): string {
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 5)}${'*'.repeat(Math.min(24, value.length - 9))}${value.slice(-4)}`;
}
