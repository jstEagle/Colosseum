/**
 * Replays. Everything the referee said during a match — every line in both
 * panes, every herald, every change in the tally — is kept with its time, so
 * the fight can be watched again exactly as it happened, at any speed.
 * Stored one file per match in ~/.colosseum/replays; the newest 50 are kept.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent, Side } from './protocol.js';
import type { BattleConfig, BattleOutcome, Herald, MatchRecord, SideStats } from './referee.js';

export const REPLAY_DIR = join(homedir(), '.colosseum', 'replays');
const KEEP = 50;

export type ReplayEvent =
  | { t: number; type: 'event'; side: Side; event: AgentEvent }
  | { t: number; type: 'herald'; herald: Herald }
  | { t: number; type: 'stats'; stats: Record<Side, SideStats> };

export interface Replay {
  id: string;
  savedAt: string;
  config: BattleConfig;
  outcome: BattleOutcome;
  record: MatchRecord | null;
  events: ReplayEvent[];
}

export interface ReplaySummary {
  id: string;
  savedAt: string;
  config: BattleConfig;
  outcome: BattleOutcome;
  durationMs: number;
}

export function saveReplay(replay: Replay): string {
  mkdirSync(REPLAY_DIR, { recursive: true });
  const path = join(REPLAY_DIR, `${replay.id}.json`);
  writeFileSync(path, JSON.stringify(replay), { mode: 0o600 });
  prune();
  return path;
}

function files(): { file: string; mtime: number }[] {
  if (!existsSync(REPLAY_DIR)) return [];
  return readdirSync(REPLAY_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: f, mtime: statSync(join(REPLAY_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

function prune() {
  for (const { file } of files().slice(KEEP)) {
    try {
      unlinkSync(join(REPLAY_DIR, file));
    } catch {
      /* already gone */
    }
  }
}

export function loadReplay(id: string): Replay | null {
  const wanted = id === 'latest' ? files()[0]?.file : `${id}.json`;
  if (!wanted) return null;
  try {
    return JSON.parse(readFileSync(join(REPLAY_DIR, wanted), 'utf8'));
  } catch {
    return null;
  }
}

export function listReplays(limit = 10): ReplaySummary[] {
  const out: ReplaySummary[] = [];
  for (const { file } of files().slice(0, limit)) {
    const r = loadReplay(file.replace(/\.json$/, ''));
    if (!r) continue;
    out.push({
      id: r.id,
      savedAt: r.savedAt,
      config: r.config,
      outcome: r.outcome,
      durationMs: r.record?.durationMs ?? r.events[r.events.length - 1]?.t ?? 0,
    });
  }
  return out;
}

/** "3m ago", "yesterday", for menus. */
export function ago(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
