/**
 * Saved match configurations, and the last one fought, so a favourite
 * matchup is one keypress away. Kept in ~/.colosseum/presets.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { BattleConfig } from './referee.js';
import { getDifficulty } from './difficulty.js';

export const PRESETS_FILE = join(homedir(), '.colosseum', 'presets.json');

interface Store {
  presets: Record<string, BattleConfig>;
  last?: BattleConfig;
}

function read(): Store {
  if (!existsSync(PRESETS_FILE)) return { presets: {} };
  try {
    const s = JSON.parse(readFileSync(PRESETS_FILE, 'utf8'));
    return { presets: s.presets ?? {}, last: s.last };
  } catch {
    return { presets: {} };
  }
}

function write(store: Store) {
  mkdirSync(dirname(PRESETS_FILE), { recursive: true });
  writeFileSync(PRESETS_FILE, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
}

/** A seed pins one maze; a saved matchup should get a fresh one each time. */
const unseeded = ({ seed: _seed, ...cfg }: BattleConfig): BattleConfig => cfg;

export function listPresets(): [string, BattleConfig][] {
  return Object.entries(read().presets).sort(([a], [b]) => a.localeCompare(b));
}

export function getPreset(name: string): BattleConfig | undefined {
  return read().presets[name];
}

export function savePreset(name: string, cfg: BattleConfig) {
  const store = read();
  store.presets[name] = unseeded(cfg);
  write(store);
}

export function deletePreset(name: string) {
  const store = read();
  delete store.presets[name];
  write(store);
}

export function lastConfig(): BattleConfig | undefined {
  return read().last;
}

export function rememberLast(cfg: BattleConfig) {
  const store = read();
  store.last = unseeded(cfg);
  try {
    write(store);
  } catch {
    /* not worth interrupting a fight over */
  }
}

/** `o4-mini ⚔ haiku · hard`, for menus. */
export function describeConfig(cfg: BattleConfig): string {
  const name = (s: 'left' | 'right') => cfg[s].model.split('/').pop() || cfg[s].provider;
  return `${name('left')} ⚔ ${name('right')} · ${getDifficulty(cfg.difficultyId).id} · ${cfg.sandbox}`;
}
