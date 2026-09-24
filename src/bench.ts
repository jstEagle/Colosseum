/**
 * `colosseum bench` — the arena as a benchmark.
 *
 * A benchmark is a schedule of matches run headlessly, one after another,
 * each appended to the ledger the moment it ends. Two kinds of match:
 *
 *   duel   every pair of gladiators, played from both sides of the arena on
 *          the same seeded maze, so neither side's position nor the layout
 *          favours anyone.
 *   trial  each gladiator alone against the training dummy: how reliably and
 *          how fast it can find and kill a target that never fights back.
 *
 * `colosseum leaderboard` turns the ledger into standings; see ratings.ts.
 */
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { Referee, DEFAULT_TIME_LIMIT_MS, type BattleConfig, type MatchRecord, type SideConfig } from './referee.js';
import { DIFFICULTIES, getDifficulty } from './difficulty.js';
import { PROVIDERS, getProvider } from './models.js';
import { blockers } from './preflight.js';
import { LEDGER, VERSION, appendMatch, readLedger } from './results.js';
import { displayName, gladiatorKey, standings, type Standing } from './ratings.js';
import type { SandboxMode } from './sandbox.js';
import { Series, summarize, summaryRows, slotOf, type Tone } from './series.js';

/* ------------------------------------------------------------- styling -- */

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const grey = (n: number) => (s: string) => (tty ? `\x1b[38;5;${n}m${s}\x1b[0m` : s);
const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[22m` : s);
const white = grey(255);
const light = grey(250);
const mid = grey(245);
const dim = grey(240);
const faint = grey(237);
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].length));
const lpad = (s: string, n: number) => ' '.repeat(Math.max(0, n - [...s].length)) + s;
const secs = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`);
const kilo = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(Math.round(n)));

/* -------------------------------------------------------------- parsing -- */

/** `provider:model[@reasoning]`, e.g. `openrouter:openai/o4-mini@high`. */
export function parseGladiator(spec: string): SideConfig {
  const at = spec.lastIndexOf('@');
  const head = at > 0 ? spec.slice(0, at) : spec;
  const colon = head.indexOf(':');
  if (colon <= 0) throw new Error(`"${spec}" should look like provider:model, e.g. openrouter:openai/o4-mini`);
  const provider = head.slice(0, colon);
  const model = head.slice(colon + 1);
  if (!PROVIDERS.some((p) => p.id === provider)) {
    throw new Error(`unknown provider "${provider}" — one of: ${PROVIDERS.map((p) => p.id).join(', ')}`);
  }
  const info = getProvider(provider);
  const reasoning = at > 0 ? spec.slice(at + 1) : info.supportsReasoning ? 'medium' : 'none';
  return { provider, model, reasoning };
}

interface Plan {
  label: string;
  config: BattleConfig;
}

export function schedule(opts: {
  gladiators: SideConfig[];
  modes: string[];
  difficulties: string[];
  rounds: number;
  sandbox: SandboxMode;
  seed: number;
  timeLimitMs: number;
  settingId: string;
}): Plan[] {
  const plans: Plan[] = [];
  let seed = opts.seed;
  const base = { settingId: opts.settingId, sandbox: opts.sandbox, timeLimitMs: opts.timeLimitMs };
  const dummy: SideConfig = { provider: 'dummy', model: 'dummy', reasoning: 'none' };
  for (const difficultyId of opts.difficulties) {
    for (let round = 0; round < opts.rounds; round++) {
      if (opts.modes.includes('duel')) {
        for (let i = 0; i < opts.gladiators.length; i++) {
          for (let j = i + 1; j < opts.gladiators.length; j++) {
            const [a, b] = [opts.gladiators[i], opts.gladiators[j]];
            const s = seed++;
            // The same maze from both sides: position and layout cancel out.
            plans.push({ label: 'duel', config: { ...base, difficultyId, seed: s, left: a, right: b } });
            plans.push({ label: 'duel', config: { ...base, difficultyId, seed: s, left: b, right: a } });
          }
        }
      }
      if (opts.modes.includes('trial')) {
        for (const g of opts.gladiators) {
          plans.push({ label: 'trial', config: { ...base, difficultyId, seed: seed++, left: g, right: dummy } });
        }
      }
    }
  }
  return plans;
}

/* -------------------------------------------------------------- running -- */

function runMatch(config: BattleConfig): Promise<MatchRecord> {
  return new Promise((resolve) => {
    const ref = new Referee();
    ref.on('outcome', (_o, record: MatchRecord) => {
      // Let the referee finish clearing the arena before the next match.
      setTimeout(() => resolve(record), 900);
    });
    void ref.start(config).catch((err: any) => {
      ref.cleanup();
      resolve({
        id: ref.id,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        config,
        outcome: { kind: 'draw', finish: 'void', reason: String(err?.message ?? err) },
        stats: ref.stats,
        strikes: ref.strikes,
      });
    });
  });
}

function describe(r: MatchRecord): string {
  const o = r.outcome;
  const name = (side: 'left' | 'right') => displayName(gladiatorKey(r.config[side]));
  const verdict =
    o.kind === 'winner'
      ? `${white(bold(name(o.winner)))} ${mid(o.finish === 'kill' ? 'kills' : o.finish === 'self' ? 'wins — self-inflicted' : 'wins — collapse')}`
      : mid(`draw — ${o.finish}`);
  const wrong = `${r.stats.left.decoyHits}/${r.stats.right.decoyHits}`;
  return `${verdict} ${dim(`in ${secs(r.durationMs)} · wrong blows ${wrong}`)}`;
}

const USAGE = `${bold('colosseum bench')} — run a benchmark

  colosseum bench -g <gladiator> -g <gladiator> [options]

  A gladiator is provider:model[@reasoning], for example
    openrouter:openai/o4-mini@high   claude-cli:haiku   anthropic:claude-sonnet-5

Options
  -g, --gladiator <spec>    add a gladiator (repeatable, or comma-separated)
  -m, --mode <duel,trial>   duels between gladiators, trials against the dummy (default: both)
  -d, --difficulty <ids>    ${DIFFICULTIES.map((d) => d.id).join(', ')} (default: normal,hard)
  -r, --rounds <n>          rounds per pairing per difficulty (default: 1)
      --sandbox <mode>      guarded or sealed (default: guarded)
      --time-limit <secs>   per match (default: ${DEFAULT_TIME_LIMIT_MS / 1000})
      --seed <n>            first arena seed (default: random)
      --setting <id>        arena flavour (default: standard — keep it neutral)
      --out <file>          ledger to append to (default: ${LEDGER})
      --dry-run             print the schedule and stop
`;

export async function benchCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      gladiator: { type: 'string', short: 'g', multiple: true },
      mode: { type: 'string', short: 'm', default: 'duel,trial' },
      difficulty: { type: 'string', short: 'd', default: 'normal,hard' },
      rounds: { type: 'string', short: 'r', default: '1' },
      sandbox: { type: 'string', default: 'guarded' },
      'time-limit': { type: 'string', default: String(DEFAULT_TIME_LIMIT_MS / 1000) },
      seed: { type: 'string' },
      setting: { type: 'string', default: 'standard' },
      out: { type: 'string', default: LEDGER },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const specs = (values.gladiator ?? []).flatMap((g) => g.split(',')).map((s) => s.trim()).filter(Boolean);
  if (values.help || !specs.length) {
    process.stdout.write(USAGE);
    return values.help ? 0 : 1;
  }

  let gladiators: SideConfig[];
  try {
    gladiators = specs.map(parseGladiator);
  } catch (err: any) {
    process.stderr.write(`colosseum bench: ${err.message}\n`);
    return 1;
  }
  const modes = values.mode!.split(',').map((s) => s.trim());
  const difficulties = values.difficulty!.split(',').map((s) => s.trim());
  for (const d of difficulties) {
    if (getDifficulty(d).id !== d) {
      process.stderr.write(`colosseum bench: unknown difficulty "${d}"\n`);
      return 1;
    }
  }
  if (modes.includes('duel') && !modes.includes('trial') && gladiators.length < 2) {
    process.stderr.write('colosseum bench: a duel needs at least two gladiators\n');
    return 1;
  }
  const sandbox = values.sandbox as SandboxMode;
  const missing = blockers(gladiators.map((g) => g.provider), sandbox);
  if (missing.length && !values['dry-run']) {
    process.stderr.write(`colosseum bench: not ready to fight\n${missing.map((m) => `  ${m}\n`).join('')}`);
    return 1;
  }

  const seed = values.seed ? Number(values.seed) : randomBytes(3).readUIntBE(0, 3);
  const plans = schedule({
    gladiators,
    modes,
    difficulties,
    rounds: Math.max(1, Number(values.rounds) || 1),
    sandbox,
    seed,
    timeLimitMs: Math.max(10, Number(values['time-limit']) || 180) * 1000,
    settingId: values.setting!,
  });

  const run = `bench-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString('hex')}`;
  const worst = (plans.length * Number(values['time-limit'])) / 60;
  process.stdout.write(
    `\n  ${white(bold('C O L O S S E U M'))}  ${mid('benchmark')}  ${dim(run)}\n` +
      `  ${dim(`${plans.length} matches · ${gladiators.length} gladiators · ${difficulties.join(', ')} · ${sandbox} · seed ${seed} · at most ${worst.toFixed(0)} min`)}\n\n`,
  );

  if (values['dry-run']) {
    plans.forEach((p, i) => {
      const c = p.config;
      process.stdout.write(
        `  ${dim(lpad(String(i + 1), 3))}  ${pad(p.label, 6)} ${pad(c.difficultyId, 7)} ` +
          `${light(displayName(gladiatorKey(c.left)))} ${dim('vs')} ${light(displayName(gladiatorKey(c.right)))} ${faint(`seed ${c.seed}`)}\n`,
      );
    });
    return 0;
  }

  let interrupted = false;
  process.once('SIGINT', () => {
    interrupted = true;
    process.stdout.write(`\n  ${mid('stopping after this match…')}\n`);
  });

  for (let i = 0; i < plans.length && !interrupted; i++) {
    const { label, config: c } = plans[i];
    process.stdout.write(
      `  ${dim(lpad(`${i + 1}/${plans.length}`, 7))}  ${mid(pad(label, 6))}${dim(pad(c.difficultyId, 7))}` +
        `${light(displayName(gladiatorKey(c.left)))} ${dim('⚔')} ${light(displayName(gladiatorKey(c.right)))}  `,
    );
    const record = await runMatch(c);
    appendMatch(record, run, values.out);
    process.stdout.write(`${dim('→')} ${describe(record)}\n`);
  }

  process.stdout.write('\n');
  printStandings(readLedger(values.out).filter((m) => m.source === run), `this run  ${dim(run)}`);
  process.stdout.write(`  ${dim(`recorded in ${values.out}`)}\n\n`);
  return 0;
}

/* ---------------------------------------------------------- leaderboard -- */

export function printStandings(ledger: Parameters<typeof standings>[0], title: string) {
  const { rows, excluded } = standings(ledger);
  if (!rows.length) {
    process.stdout.write(`  ${mid('No matches on record yet. Fight one, or run `colosseum bench`.')}\n\n`);
    return;
  }
  const nameW = Math.max(9, ...rows.map((r) => [...r.name].length)) + 2;
  const head =
    pad('', 4) + pad('GLADIATOR', nameW) + lpad('RATING', 7) + lpad('W-L-D', 10) + lpad('KILL', 8) +
    lpad('TRIALS', 9) + lpad('HUNT', 8) + lpad('WRONG', 7) + lpad('FOOLED', 8) + lpad('TOKENS', 8);
  const line = '─'.repeat([...head].length);
  process.stdout.write(`  ${white(bold('Standings'))}  ${mid(title)}\n  ${faint(line)}\n  ${dim(head)}\n  ${faint(line)}\n`);
  rows.forEach((r: Standing, i) => {
    const rank = r.rating === null ? '·' : String(i + 1);
    const tone = i === 0 ? (s: string) => white(bold(s)) : i < 3 ? light : mid;
    const wld = r.duels ? `${r.wins}-${r.losses}-${r.draws}` : '—';
    const trials = r.trials ? `${r.trialKills}/${r.trials}` : '—';
    const perMatch = r.matches ? r.wrongBlows / r.matches : 0;
    process.stdout.write(
      '  ' +
        dim(pad(rank, 4)) +
        tone(pad(r.name, nameW)) +
        tone(lpad(r.rating === null ? '—' : r.rating.toFixed(0), 7)) +
        mid(lpad(wld, 10)) +
        mid(lpad(secs(r.killMs), 8)) +
        mid(lpad(trials, 9)) +
        mid(lpad(secs(r.trialKillMs), 8)) +
        mid(lpad(perMatch.toFixed(1), 7)) +
        mid(lpad(String(r.fooled), 8)) +
        dim(lpad(kilo(r.tokensPerMatch), 8)) +
        '\n',
    );
  });
  process.stdout.write(`  ${faint(line)}\n`);
  process.stdout.write(
    `  ${dim('RATING Bradley–Terry on the Elo scale, duels only · KILL median time to the killing blow')}\n` +
      `  ${dim('TRIALS kills/attempts against the dummy · HUNT median trial kill time · WRONG decoy blows per match')}\n` +
      `  ${dim('FOOLED times an opponent struck one of this gladiator\'s feints')}\n`,
  );
  if (excluded) process.stdout.write(`  ${dim(`${excluded} match(es) left out: void, or a gladiator errored`)}\n`);
  process.stdout.write('\n');
}

export async function leaderboardCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      file: { type: 'string', short: 'f', default: LEDGER },
      source: { type: 'string', short: 's' },
      difficulty: { type: 'string', short: 'd' },
      'all-versions': { type: 'boolean', default: false },
    },
  });
  // Rules change between versions, so by default only like is compared with like.
  let ledger = readLedger(values.file).filter((m) => values['all-versions'] || m.version === VERSION);
  if (values.source) ledger = ledger.filter((m) => m.source === values.source);
  if (values.difficulty) ledger = ledger.filter((m) => m.config.difficultyId === values.difficulty);
  const scope =
    [values.source, values.difficulty].filter(Boolean).join(' · ') ||
    (values['all-versions'] ? 'every match on record' : `every match under v${VERSION} rules`);
  process.stdout.write(`\n  ${white(bold('C O L O S S E U M'))}  ${mid('hall of champions')}\n\n`);
  printStandings(ledger, `${scope}  ${dim(`(${ledger.length} matches)`)}`);
  return 0;
}

/* --------------------------------------------------------------- series -- */

const TONE: Record<Tone, (s: string) => string> = {
  white: white,
  bright: light,
  text: grey(252),
  muted: mid,
  faint: grey(243),
  dim: dim,
  ghost: faint,
};

const SERIES_USAGE = `${bold('colosseum series')} — fight the same matchup many times at once

  colosseum series -g <A> -g <B> [-n 10] [options]

  Slot A and slot B swap sides every other fight, so the seat cancels out.
  Every fight is recorded, and can be watched again with  colosseum replay .

Options
  -g, --gladiator <spec>    exactly two: provider:model[@reasoning]
  -n, --count <n>           how many fights (default 10)
  -p, --parallel <n>        at once (default: all, at most 8)
  -d, --difficulty <id>     ${DIFFICULTIES.map((d) => d.id).join(', ')} (default: normal)
      --sandbox <mode>      guarded or sealed (default: guarded)
      --time-limit <secs>   per fight (default: ${DEFAULT_TIME_LIMIT_MS / 1000})
      --setting <id>        arena flavour (default: standard)
      --no-swap             keep A on the left every time
`;

export async function seriesCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      gladiator: { type: 'string', short: 'g', multiple: true },
      count: { type: 'string', short: 'n', default: '10' },
      parallel: { type: 'string', short: 'p' },
      difficulty: { type: 'string', short: 'd', default: 'normal' },
      sandbox: { type: 'string', default: 'guarded' },
      'time-limit': { type: 'string', default: String(DEFAULT_TIME_LIMIT_MS / 1000) },
      setting: { type: 'string', default: 'standard' },
      'no-swap': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const specs = (values.gladiator ?? []).flatMap((g) => g.split(',')).map((s) => s.trim()).filter(Boolean);
  if (values.help || specs.length !== 2) {
    process.stdout.write(SERIES_USAGE);
    return values.help ? 0 : 1;
  }
  let a: SideConfig, b: SideConfig;
  try {
    [a, b] = specs.map(parseGladiator);
  } catch (err: any) {
    process.stderr.write(`colosseum series: ${err.message}\n`);
    return 1;
  }
  const difficultyId = values.difficulty!;
  if (getDifficulty(difficultyId).id !== difficultyId) {
    process.stderr.write(`colosseum series: unknown difficulty "${difficultyId}"\n`);
    return 1;
  }
  const sandbox = values.sandbox as SandboxMode;
  const missing = blockers([a.provider, b.provider], sandbox);
  if (missing.length) {
    process.stderr.write(`colosseum series: not ready to fight\n${missing.map((m) => `  ${m}\n`).join('')}`);
    return 1;
  }
  const count = Math.max(1, Number(values.count) || 10);
  const parallel = Math.max(1, Number(values.parallel) || Math.min(count, 8));
  const timeLimitMs = Math.max(10, Number(values['time-limit']) || 180) * 1000;
  const config: BattleConfig = { left: a, right: b, settingId: values.setting!, difficultyId, sandbox, timeLimitMs };
  const series = new Series({ config, count, parallel, swap: !values['no-swap'] });

  process.stdout.write(
    `\n  ${white(bold('C O L O S S E U M'))}  ${mid('series')}  ${dim(series.id)}\n` +
      `  ${light(`A  ${displayName(gladiatorKey(a))}`)}  ${dim('vs')}  ${light(`B  ${displayName(gladiatorKey(b))}`)}\n` +
      `  ${dim(`${count} fights · ${parallel} at once · ${difficultyId} · ${sandbox}${values['no-swap'] ? '' : ' · sides swap'}`)}\n\n`,
  );

  let reported = 0;
  series.on('update', () => {
    for (const f of series.fights) {
      if (f.state !== 'done' || f.index < reported) continue;
      if (f.index !== reported) break;
      reported++;
      const o = f.record!.outcome;
      const who = o.kind === 'winner' ? slotOf(f, o.winner) : null;
      process.stdout.write(
        `  ${dim(lpad(`${f.index + 1}/${count}`, 7))}  ${who ? white(bold(`${who} wins`)) : mid('draw   ')}` +
          `  ${dim(`${o.finish} · ${secs(f.record!.durationMs)} · A sat ${f.leftSlot === 'A' ? 'left' : 'right'}`)}\n`,
      );
    }
  });
  let interrupted = false;
  process.once('SIGINT', () => {
    interrupted = true;
    series.stop();
  });
  await new Promise<void>((resolve) => {
    series.on('done', resolve);
    const poll = setInterval(() => {
      if (interrupted) {
        clearInterval(poll);
        resolve();
      }
    }, 200);
    series.on('done', () => clearInterval(poll));
    series.start();
  });

  const width = Math.min(process.stdout.columns ?? 100, 110) - 4;
  const rows = summaryRows(summarize(series.fights, config), width, timeLimitMs);
  process.stdout.write('\n');
  for (const row of rows) {
    process.stdout.write('  ' + row.map(([text, tone, b]) => (b ? bold(TONE[tone](text)) : TONE[tone](text))).join('') + '\n');
  }
  process.stdout.write(`\n  ${dim(`recorded in ${LEDGER} as ${series.id} · watch any fight with  colosseum replay`)}\n\n`);
  return 0;
}
