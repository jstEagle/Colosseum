/**
 * Turning a ledger of matches into a leaderboard.
 *
 * Two kinds of evidence are kept apart:
 *
 *   duels  — two models against each other. Rated with Bradley–Terry, fitted
 *            by minorisation–maximisation, and shown on the familiar Elo
 *            scale. Unlike running Elo it does not care what order the
 *            matches were played in. Each model also plays one virtual draw
 *            against an average opponent, which keeps a perfect record from
 *            running off to infinity.
 *   trials — one model against the training dummy. No opponent to blame or
 *            credit, so this is the purest measure of how well a model hunts:
 *            how often it gets its kill, how fast, and how many wrong blows.
 */
import { getProvider } from './models.js';
import type { LedgerEntry } from './results.js';
import type { SideConfig } from './referee.js';
import { SIDES, type Side } from './protocol.js';

export function gladiatorKey(sc: SideConfig): string {
  const reasoning = sc.reasoning && sc.reasoning !== 'none' ? `@${sc.reasoning}` : '';
  return `${sc.provider}:${sc.model}${reasoning}`;
}

/** A shorter name for tables: the model id, which is what people compare. */
export function displayName(key: string): string {
  const [provider, ...rest] = key.split(':');
  const model = rest.join(':');
  if (provider === 'claude-cli') return `claude-cli/${model}`;
  if (provider === 'codex-cli') return `codex-cli/${model}`;
  return model || provider;
}

const isDummy = (sc: SideConfig) => getProvider(sc.provider).backend === 'dummy';

/** A match only counts if it was actually fought. */
export function countable(m: LedgerEntry): boolean {
  if (m.outcome.finish === 'void') return false;
  return SIDES.every((s) => !['error', 'crash'].includes(m.stats[s].finished ?? ''));
}

export interface Standing {
  key: string;
  name: string;
  rating: number | null;
  duels: number;
  wins: number;
  losses: number;
  draws: number;
  /** Median time to the killing blow, over this model's kills. */
  killMs: number | null;
  wrongBlows: number;
  /** Times an opponent struck one of this gladiator's feints. */
  fooled: number;
  trials: number;
  trialKills: number;
  trialKillMs: number | null;
  tokensPerMatch: number;
  costUsd: number;
  matches: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Fit Bradley–Terry strengths. Returns ratings on the Elo scale. */
export function bradleyTerry(games: { a: string; b: string; score: number }[]): Map<string, number> {
  const players = [...new Set(games.flatMap((g) => [g.a, g.b]))];
  const ANCHOR = '\u0000anchor';
  const all = [...players, ANCHOR];
  const wins = new Map<string, number>(all.map((p) => [p, 0]));
  const pairs = new Map<string, Map<string, number>>(all.map((p) => [p, new Map()]));
  const play = (a: string, b: string, score: number) => {
    wins.set(a, wins.get(a)! + score);
    wins.set(b, wins.get(b)! + (1 - score));
    pairs.get(a)!.set(b, (pairs.get(a)!.get(b) ?? 0) + 1);
    pairs.get(b)!.set(a, (pairs.get(b)!.get(a) ?? 0) + 1);
  };
  for (const g of games) play(g.a, g.b, g.score);
  for (const p of players) play(p, ANCHOR, 0.5);

  const strength = new Map<string, number>(all.map((p) => [p, 1]));
  for (let iter = 0; iter < 500; iter++) {
    let delta = 0;
    for (const p of players) {
      let denom = 0;
      for (const [q, n] of pairs.get(p)!) denom += n / (strength.get(p)! + strength.get(q)!);
      const next = Math.max(1e-9, wins.get(p)! / denom);
      delta = Math.max(delta, Math.abs(Math.log(next / strength.get(p)!)));
      strength.set(p, next);
    }
    if (delta < 1e-9) break;
  }
  const out = new Map<string, number>();
  for (const p of players) out.set(p, 1500 + 400 * Math.log10(strength.get(p)! / strength.get(ANCHOR)!));
  return out;
}

export function standings(ledger: LedgerEntry[]): { rows: Standing[]; excluded: number } {
  const matches = ledger.filter(countable);
  const excluded = ledger.length - matches.length;
  const rows = new Map<string, Standing>();
  const killTimes = new Map<string, number[]>();
  const trialTimes = new Map<string, number[]>();
  const tokens = new Map<string, number>();
  const row = (key: string) => {
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        name: displayName(key),
        rating: null,
        duels: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        killMs: null,
        wrongBlows: 0,
        fooled: 0,
        trials: 0,
        trialKills: 0,
        trialKillMs: null,
        tokensPerMatch: 0,
        costUsd: 0,
        matches: 0,
      });
    }
    return rows.get(key)!;
  };

  const games: { a: string; b: string; score: number }[] = [];
  for (const m of matches) {
    const dummies = SIDES.filter((s) => isDummy(m.config[s]));
    if (dummies.length === 2) continue;
    const trial = dummies.length === 1;
    for (const side of SIDES) {
      if (isDummy(m.config[side])) continue;
      const key = gladiatorKey(m.config[side]);
      const r = row(key);
      const st = m.stats[side];
      r.matches++;
      r.wrongBlows += st.decoyHits;
      r.fooled += st.fooled ?? 0;
      r.costUsd += st.costUsd;
      tokens.set(key, (tokens.get(key) ?? 0) + st.inputTokens + st.outputTokens);
      const won = m.outcome.kind === 'winner' && m.outcome.winner === side;
      const killedAt = won && m.outcome.finish === 'kill' ? killTime(m, side) : null;
      if (trial) {
        r.trials++;
        if (won) r.trialKills++;
        if (killedAt !== null) trialTimes.set(key, [...(trialTimes.get(key) ?? []), killedAt]);
        continue;
      }
      r.duels++;
      if (m.outcome.kind === 'draw') r.draws++;
      else if (won) r.wins++;
      else r.losses++;
      if (killedAt !== null) killTimes.set(key, [...(killTimes.get(key) ?? []), killedAt]);
    }
    if (!trial) {
      const a = gladiatorKey(m.config.left);
      const b = gladiatorKey(m.config.right);
      if (a === b) continue; // a mirror match says nothing about strength
      const score = m.outcome.kind === 'draw' ? 0.5 : m.outcome.winner === 'left' ? 1 : 0;
      games.push({ a, b, score });
    }
  }

  const ratings = bradleyTerry(games);
  for (const r of rows.values()) {
    r.rating = ratings.get(r.key) ?? null;
    r.killMs = median(killTimes.get(r.key) ?? []);
    r.trialKillMs = median(trialTimes.get(r.key) ?? []);
    r.tokensPerMatch = r.matches ? (tokens.get(r.key) ?? 0) / r.matches : 0;
  }

  const sorted = [...rows.values()].sort(
    (x, y) =>
      (y.rating ?? -Infinity) - (x.rating ?? -Infinity) ||
      y.trialKills / Math.max(1, y.trials) - x.trialKills / Math.max(1, x.trials),
  );
  return { rows: sorted, excluded };
}

/** When the winning side struck the killing blow, in ms from the start. */
function killTime(m: LedgerEntry, side: Side): number {
  const blows = m.strikes.filter((s) => s.side === side && s.kind === 'enemy');
  return blows.length ? blows[blows.length - 1].at : m.durationMs;
}
