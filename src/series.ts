/**
 * A series: the same matchup fought many times at once, for a quick answer
 * to "which of these two is stronger?".
 *
 * The two gladiators are slots A and B. By default they swap sides every
 * other fight, so the left seat's advantage (if any) cancels out. Every fight
 * lands in the ledger and on the replay reel like any other, and the summary
 * — win share with a confidence interval, a significance test, kill-time
 * distributions and the rest — is computed here for both the TUI and the
 * headless `colosseum series`.
 */
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { Referee, type BattleConfig, type MatchRecord, type SideConfig } from './referee.js';
import { appendMatch } from './results.js';
import { saveReplay, type ReplayEvent } from './replays.js';
import { gladiatorKey } from './ratings.js';
import { SIDES, type Side } from './protocol.js';
import type { Herald, SideStats } from './referee.js';

export type Slot = 'A' | 'B';

export interface SeriesFight {
  index: number;
  /** Which slot sat on the left in this fight. */
  leftSlot: Slot;
  config: BattleConfig;
  state: 'queued' | 'running' | 'done';
  startedAt?: number;
  lastHerald?: string;
  record?: MatchRecord;
}

export interface SeriesOptions {
  /** Slot A is the config's left gladiator, slot B its right. */
  config: BattleConfig;
  count: number;
  /** Fights running at the same time. */
  parallel: number;
  /** Swap sides every other fight. */
  swap: boolean;
}

export const slotOf = (f: SeriesFight, side: Side): Slot => (side === 'left' ? f.leftSlot : f.leftSlot === 'A' ? 'B' : 'A');
export const sideOf = (f: SeriesFight, slot: Slot): Side => (f.leftSlot === slot ? 'left' : 'right');

/**
 * Events:
 *   'update'  — something changed; read .fights
 *   'done'    — every fight is over
 */
export class Series extends EventEmitter {
  readonly id = `series-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString('hex')}`;
  readonly fights: SeriesFight[];
  private referees = new Set<Referee>();
  private stopped = false;
  private finished = false;

  constructor(readonly options: SeriesOptions) {
    super();
    const { config } = options;
    this.fights = Array.from({ length: options.count }, (_, index) => {
      const leftSlot: Slot = options.swap && index % 2 === 1 ? 'B' : 'A';
      const [left, right]: SideConfig[] = leftSlot === 'A' ? [config.left, config.right] : [config.right, config.left];
      return { index, leftSlot, state: 'queued', config: { ...config, left, right, seed: undefined } };
    });
  }

  start() {
    const workers = Math.max(1, Math.min(this.options.parallel, this.fights.length));
    for (let i = 0; i < workers; i++) void this.worker();
    return this;
  }

  private async worker() {
    for (;;) {
      if (this.stopped) return;
      const next = this.fights.find((f) => f.state === 'queued');
      if (!next) break;
      next.state = 'running';
      next.startedAt = Date.now();
      this.emit('update');
      await this.fight(next);
    }
    if (!this.finished && this.fights.every((f) => f.state === 'done')) {
      this.finished = true;
      this.emit('done');
    }
  }

  private fight(f: SeriesFight): Promise<void> {
    return new Promise((resolve) => {
      const ref = new Referee();
      this.referees.add(ref);
      const events: ReplayEvent[] = [];
      const t = () => Date.now() - (f.startedAt ?? Date.now());
      ref.on('event', (side: Side, event) => events.push({ t: t(), type: 'event', side, event }));
      ref.on('stats', (stats: Record<Side, SideStats>) => events.push({ t: t(), type: 'stats', stats: structuredClone(stats) }));
      ref.on('herald', (herald: Herald) => {
        events.push({ t: t(), type: 'herald', herald });
        f.lastHerald = herald.text;
        this.emit('update');
      });
      ref.on('outcome', (outcome, record: MatchRecord) => {
        f.record = record;
        f.state = 'done';
        if (outcome.finish !== 'void') {
          try {
            appendMatch(record, this.id);
            saveReplay({ id: record.id, savedAt: new Date().toISOString(), config: f.config, outcome, record, events });
          } catch {
            /* the series goes on */
          }
        }
        this.emit('update');
        // Let the referee clear the arena before the next fight takes a slot.
        setTimeout(() => {
          this.referees.delete(ref);
          resolve();
        }, 900);
      });
      void ref.start(f.config).catch((err: any) => {
        f.state = 'done';
        f.record = {
          id: ref.id,
          startedAt: new Date().toISOString(),
          durationMs: 0,
          config: f.config,
          outcome: { kind: 'draw', finish: 'void', reason: String(err?.message ?? err) },
          stats: ref.stats,
          strikes: ref.strikes,
        };
        ref.cleanup();
        this.referees.delete(ref);
        this.emit('update');
        resolve();
      });
    });
  }

  /** Abandon the series: running fights are cleared, not recorded. */
  stop() {
    this.stopped = true;
    for (const ref of this.referees) ref.cleanup();
    this.referees.clear();
  }
}

/* ------------------------------------------------------------ summary -- */

export interface SlotSummary {
  slot: Slot;
  name: string;
  wins: number;
  /** Win share among decided fights, and its 95% Wilson interval. */
  share: number;
  low: number;
  high: number;
  killTimes: number[];
  medianKill: number | null;
  medianFirstBlow: number | null;
  wrongPerFight: number;
  feints: number;
  fooled: number;
  stunnedMs: number;
  tokensPerFight: number;
  costUsd: number;
  selfKills: number;
}

export interface SeriesSummary {
  fights: number;
  decided: number;
  draws: number;
  void: number;
  slots: Record<Slot, SlotSummary>;
  /** Two-sided exact binomial test that the two are evenly matched. */
  pValue: number;
  /** The slot ahead, or null if level. */
  leader: Slot | null;
  /** Winner of each fight in order: A, B, or '=' for a draw, '·' unfinished. */
  sequence: string[];
  /** How the fights ended. */
  finishes: Record<string, number>;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Wilson score interval for k successes in n trials. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/** Two-sided exact binomial test of k wins in n against a fair coin. */
export function binomialP(k: number, n: number): number {
  if (n === 0) return 1;
  const pmf = (i: number) => {
    let logC = 0;
    for (let j = 1; j <= i; j++) logC += Math.log((n - i + j) / j);
    return Math.exp(logC - n * Math.LN2);
  };
  const observed = pmf(k);
  let p = 0;
  for (let i = 0; i <= n; i++) {
    const q = pmf(i);
    if (q <= observed * (1 + 1e-9)) p += q;
  }
  return Math.min(1, p);
}

export function summarize(fights: SeriesFight[], config: BattleConfig): SeriesSummary {
  const names: Record<Slot, string> = { A: gladiatorKey(config.left), B: gladiatorKey(config.right) };
  const done = fights.filter((f) => f.state === 'done' && f.record);
  const counted = done.filter((f) => f.record!.outcome.finish !== 'void');
  const finishes: Record<string, number> = {};
  const acc: Record<Slot, { wins: number; kills: number[]; first: number[]; wrong: number; feints: number; fooled: number; stunned: number; tokens: number; cost: number; self: number }> = {
    A: { wins: 0, kills: [], first: [], wrong: 0, feints: 0, fooled: 0, stunned: 0, tokens: 0, cost: 0, self: 0 },
    B: { wins: 0, kills: [], first: [], wrong: 0, feints: 0, fooled: 0, stunned: 0, tokens: 0, cost: 0, self: 0 },
  };
  let draws = 0;
  for (const f of counted) {
    const r = f.record!;
    finishes[r.outcome.finish] = (finishes[r.outcome.finish] ?? 0) + 1;
    if (r.outcome.kind === 'draw') draws++;
    for (const side of SIDES) {
      const slot = slotOf(f, side);
      const a = acc[slot];
      const st = r.stats[side];
      a.wrong += st.decoyHits;
      a.feints += st.feints ?? 0;
      a.fooled += st.fooled ?? 0;
      a.stunned += st.stunnedMs;
      a.tokens += st.inputTokens + st.outputTokens;
      a.cost += st.costUsd;
      if (st.firstStrikeMs !== null) a.first.push(st.firstStrikeMs);
      if (r.outcome.kind === 'winner' && r.outcome.winner === side) {
        a.wins++;
        const blow = r.strikes.filter((s) => s.side === side && s.kind === 'enemy').pop();
        if (r.outcome.finish === 'kill') a.kills.push(blow?.at ?? r.durationMs);
      }
      if (r.strikes.some((s) => s.side === side && s.kind === 'self')) a.self++;
    }
  }
  const decided = acc.A.wins + acc.B.wins;
  const slot = (s: Slot): SlotSummary => {
    const a = acc[s];
    const [low, high] = wilson(a.wins, decided);
    const n = Math.max(1, counted.length);
    return {
      slot: s,
      name: names[s],
      wins: a.wins,
      share: decided ? a.wins / decided : 0.5,
      low,
      high,
      killTimes: a.kills,
      medianKill: median(a.kills),
      medianFirstBlow: median(a.first),
      wrongPerFight: a.wrong / n,
      feints: a.feints,
      fooled: a.fooled,
      stunnedMs: a.stunned,
      tokensPerFight: a.tokens / n,
      costUsd: a.cost,
      selfKills: a.self,
    };
  };
  const sequence = fights.map((f) => {
    const o = f.record?.outcome;
    if (f.state !== 'done' || !o || o.finish === 'void') return '·';
    return o.kind === 'draw' ? '=' : slotOf(f, o.winner);
  });
  return {
    fights: fights.length,
    decided,
    draws,
    void: done.length - counted.length,
    slots: { A: slot('A'), B: slot('B') },
    pValue: binomialP(acc.A.wins, decided),
    leader: acc.A.wins === acc.B.wins ? null : acc.A.wins > acc.B.wins ? 'A' : 'B',
    sequence,
    finishes,
  };
}

/* ---------------------------------------------------------- the story -- */

/** A styled run of text: the TUI maps tones to theme colours, the CLI to ANSI. */
export type Tone = 'white' | 'bright' | 'text' | 'muted' | 'faint' | 'dim' | 'ghost';
export type Seg = [string, Tone, boolean?];
export type Row = Seg[];

const secs = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const kilo = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(Math.round(n)));
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].length));
const lpad = (s: string, n: number) => ' '.repeat(Math.max(0, n - [...s].length)) + s;

/** Fixed-width display name for a slot. */
export function slotLabel(sum: SeriesSummary, s: Slot, width = 30): string {
  const name = sum.slots[s].name.replace(/^[a-z-]+:/, '');
  // Cut from the front: two models from one family differ at the end
  // (…@low, …@high), and that is the part worth keeping.
  const room = width - 4;
  return `${s}  ${name.length > room ? '…' + name.slice(name.length - room + 1) : name}`;
}

/**
 * The series told as charts, in rows of styled text, `width` columns wide:
 * the verdict, the win share with its interval, fight by fight, the kill
 * times on one axis, and the tally.
 */
export function summaryRows(sum: SeriesSummary, width: number, timeLimitMs: number): Row[] {
  const rows: Row[] = [];
  const A = sum.slots.A;
  const B = sum.slots.B;
  const labelW = Math.min(34, Math.max(18, Math.floor(width * 0.3)));
  const barW = Math.max(20, width - labelW - 26);

  // The verdict, in words and with its honesty attached.
  const lead = sum.leader;
  const verdict: Row = lead
    ? [
        [`${lead}  `, 'white', true],
        [sum.slots[lead].name.replace(/^[a-z-]+:/, ''), 'white', true],
        [`  wins the series ${Math.max(A.wins, B.wins)}–${Math.min(A.wins, B.wins)}`, 'bright', true],
        [sum.draws ? `  ·  ${sum.draws} drawn` : '', 'muted'],
      ]
    : [[`Level at ${A.wins}–${B.wins}`, 'white', true], [sum.draws ? `  ·  ${sum.draws} drawn` : '', 'muted']];
  rows.push(verdict);
  const p = sum.pValue;
  rows.push([
    [
      sum.decided < 5
        ? 'Too few decided fights to tell them apart — run more.'
        : p < 0.01
          ? `A decisive gap: this result would happen by chance ${p < 0.001 ? '<0.1' : (p * 100).toFixed(1)}% of the time (p = ${p.toFixed(3)}).`
          : p < 0.05
            ? `A real gap, probably: p = ${p.toFixed(3)} — chance alone rarely does this.`
            : `Not yet conclusive: p = ${p.toFixed(2)} — this could be luck. More fights will tell.`,
      'muted',
    ],
  ]);
  rows.push([]);

  // Win share: a bar per slot, with the 95% interval drawn around it.
  rows.push([['WIN SHARE', 'dim'], ['   of decided fights · the bracket is the 95% interval', 'ghost']]);
  for (const s of [A, B]) {
    const cells: string[] = Array.from({ length: barW }, (_, i) => {
      const x = (i + 0.5) / barW;
      return x <= s.share ? '█' : x >= s.low && x <= s.high ? '─' : ' ';
    });
    const lo = Math.min(barW - 1, Math.floor(s.low * barW));
    const hi = Math.min(barW - 1, Math.floor(s.high * barW));
    if (cells[lo] !== '█') cells[lo] = '[';
    if (cells[hi] !== '█') cells[hi] = ']';
    const tone: Tone = lead === s.slot ? 'white' : 'faint';
    rows.push([
      [pad(slotLabel(sum, s.slot, labelW - 2), labelW), tone, lead === s.slot],
      [cells.join(''), tone],
      [`  ${lpad(pct(s.share), 4)}  ${lpad(`${s.wins}`, 3)} won`, 'muted'],
      [`  ${pct(s.low)}–${pct(s.high)}`, 'dim'],
    ]);
  }
  rows.push([]);

  // Fight by fight, in order.
  rows.push([['FIGHT BY FIGHT', 'dim'], ['   A ■   B □   draw =   running ·', 'ghost']]);
  const glyph: Record<string, [string, Tone]> = { A: ['■', 'white'], B: ['□', 'muted'], '=': ['=', 'dim'], '·': ['·', 'ghost'] };
  const perRow = Math.max(10, Math.floor((width - 2) / 2));
  for (let i = 0; i < sum.sequence.length; i += perRow) {
    rows.push(sum.sequence.slice(i, i + perRow).map((w) => [glyph[w][0] + ' ', glyph[w][1]] as Seg));
  }
  rows.push([]);

  // Kill times on one axis: when each slot's winning blows landed.
  const axisW = Math.max(20, width - labelW - 10);
  // Scaled to the slowest kill, not the time limit, so the spread is visible.
  const slowest = Math.max(...A.killTimes, ...B.killTimes, 0);
  const maxT = slowest ? Math.min(timeLimitMs, Math.ceil((slowest * 1.15) / 10_000) * 10_000) : timeLimitMs;
  rows.push([['KILL TIMES', 'dim'], [`   when each winning blow landed · 0 to ${Math.round(maxT / 1000)}s · median ┃`, 'ghost']]);
  for (const s of [A, B]) {
    const counts = new Array(axisW).fill(0);
    for (const t of s.killTimes) counts[Math.min(axisW - 1, Math.floor((t / maxT) * axisW))]++;
    const med = s.medianKill === null ? -1 : Math.min(axisW - 1, Math.floor((s.medianKill / maxT) * axisW));
    const strip = counts.map((c, i) => (c === 0 ? (i === med ? '┃' : '┄') : c === 1 ? '●' : c < 10 ? String(c) : '+'));
    const tone: Tone = lead === s.slot ? 'white' : 'faint';
    rows.push([
      [pad(slotLabel(sum, s.slot, labelW - 2), labelW), tone, lead === s.slot],
      [strip.join(''), tone],
      [`  ${lpad(secs(s.medianKill), 6)}`, 'muted'],
    ]);
  }
  rows.push([]);

  // The tally, side by side.
  const colW = Math.max(12, Math.floor((width - 22) / 2));
  rows.push([
    [pad('', 22), 'dim'],
    [lpad(slotLabel(sum, 'A', colW - 1), colW), lead === 'A' ? 'white' : 'faint', true],
    [lpad(slotLabel(sum, 'B', colW - 1), colW), lead === 'B' ? 'white' : 'faint', true],
  ]);
  const line = (label: string, a: string, b: string): Row => [
    [pad(label, 22), 'dim'],
    [lpad(a, colW), lead === 'A' ? 'bright' : 'muted'],
    [lpad(b, colW), lead === 'B' ? 'bright' : 'muted'],
  ];
  rows.push(line('wins', String(A.wins), String(B.wins)));
  rows.push(line('median kill', secs(A.medianKill), secs(B.medianKill)));
  rows.push(line('median first blow', secs(A.medianFirstBlow), secs(B.medianFirstBlow)));
  rows.push(line('wrong blows / fight', A.wrongPerFight.toFixed(1), B.wrongPerFight.toFixed(1)));
  rows.push(line('feints · fooled', `${A.feints} · ${A.fooled}`, `${B.feints} · ${B.fooled}`));
  rows.push(line('struck itself', String(A.selfKills), String(B.selfKills)));
  rows.push(line('tokens / fight', kilo(A.tokensPerFight), kilo(B.tokensPerFight)));
  if (A.costUsd || B.costUsd) rows.push(line('cost', `$${A.costUsd.toFixed(3)}`, `$${B.costUsd.toFixed(3)}`));
  const ends = Object.entries(sum.finishes)
    .map(([k, v]) => `${v} ${k}`)
    .join(' · ');
  rows.push([]);
  rows.push([
    ['how they ended  ', 'dim'],
    [ends || '—', 'muted'],
    [sum.void ? `  ·  ${sum.void} void` : '', 'dim'],
  ]);
  return rows;
}
