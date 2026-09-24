/**
 * The match ledger.
 *
 * Every finished match — from the arena or from a benchmark run — is kept as
 * one JSON line, so a leaderboard can be rebuilt from nothing but the file,
 * and a run can be shared, merged with someone else's, or replayed.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import type { MatchRecord } from './referee.js';

export const LEDGER = join(homedir(), '.colosseum', 'matches.jsonl');

export const VERSION: string = (() => {
  try {
    return createRequire(import.meta.url)('../package.json').version;
  } catch {
    return '0.0.0';
  }
})();

export interface LedgerEntry extends MatchRecord {
  version: string;
  /** Where the match came from: the arena, or a named benchmark run. */
  source: string;
}

export function appendMatch(record: MatchRecord, source: string, file = LEDGER): string {
  const entry: LedgerEntry = { ...record, version: VERSION, source };
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(entry) + '\n', { mode: 0o600 });
  return file;
}

export function readLedger(file = LEDGER): LedgerEntry[] {
  if (!existsSync(file)) return [];
  const out: LedgerEntry[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* a torn line from an interrupted write */
    }
  }
  return out;
}
