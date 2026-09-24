import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createArena, parseSignal, type Arena, type ExecResult } from './arena.js';
import { MatchScratch, cleanEnv, seatbeltAvailable, type SandboxMode } from './sandbox.js';
import { DEFENCE, disguiseNames, getDifficulty, seededRandom, type Difficulty } from './difficulty.js';
import { getProvider } from './models.js';
import { SIDES, other, sanitize } from './protocol.js';
import type { AgentEvent, BattleBrief, RefereeMessage, Side, Usage } from './protocol.js';

export interface SideConfig {
  provider: string;
  model: string;
  reasoning: string;
}

export interface BattleConfig {
  left: SideConfig;
  right: SideConfig;
  settingId: string;
  difficultyId: string;
  sandbox: SandboxMode;
  /** Seeds the arena's layout, so a benchmark can replay the same maze. */
  seed?: number;
  /** How long before the match is called a draw. */
  timeLimitMs?: number;
}

export const DEFAULT_TIME_LIMIT_MS = 180_000;

/** How a match ended, in words a leaderboard can count. */
export type Finish =
  | 'kill' // one body was struck down by the other side
  | 'self' // a gladiator struck its own body
  | 'collapse' // a body died with no blow landed: a crash
  | 'double' // both fell together
  | 'timeout' // time ran out with both standing
  | 'truce' // both gladiators stopped fighting
  | 'void'; // the match could not be held

export type BattleOutcome =
  | { kind: 'winner'; winner: Side; loser: Side; finish: Finish; reason: string }
  | { kind: 'draw'; finish: Finish; reason: string };

export type StrikeKind = 'enemy' | 'decoy' | 'self' | 'refused' | 'missed';

export interface Strike {
  side: Side;
  pid: number;
  signal: string;
  kind: StrikeKind;
  /** Milliseconds since the gates opened. */
  at: number;
}

export interface SideStats {
  commands: number;
  strikes: number;
  decoyHits: number;
  refused: number;
  /** When this side first landed a blow on anything, in ms. */
  firstStrikeMs: number | null;
  stunnedMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  errors: number;
  /** Look-alikes this side planted, and how often the enemy fell for one. */
  feints: number;
  fooled: number;
  disguises: number;
  /** Why the agent loop ended, if it did. */
  finished: string | null;
}

export interface MatchRecord {
  id: string;
  startedAt: string;
  durationMs: number;
  config: BattleConfig;
  outcome: BattleOutcome;
  stats: Record<Side, SideStats>;
  strikes: Strike[];
}

/** Something the herald announces to the crowd. */
export interface Herald {
  text: string;
  side?: Side;
  tone: 'info' | 'strike' | 'decoy' | 'refused' | 'death';
  at: number;
}

const emptyStats = (): SideStats => ({
  commands: 0,
  strikes: 0,
  decoyHits: 0,
  refused: 0,
  firstStrikeMs: null,
  stunnedMs: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  errors: 0,
  feints: 0,
  fooled: 0,
  disguises: 0,
  finished: null,
});

interface Gladiator {
  side: Side;
  child: ChildProcess;
  bodyPid?: number;
  bodyName: string;
  exited: boolean;
  exitAt?: number;
  /** Requests are handled one at a time per side, in order. */
  queue: Promise<unknown>;
  /** Resolves once the gladiator has taken its name and is listening. */
  ready: Promise<void>;
  stunnedUntil: number;
  lastStrikeAt: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What a feint or a disguise may be called: something that fits in `ps`. */
const NAME_OK = /^[A-Za-z0-9_.:\/ -]{1,40}$/;
const EXEC_TIMEOUT_MS = 20_000;
const OUTPUT_CAP = 64 * 1024;

/**
 * The Referee stands the arena up, spawns both gladiators, relays their
 * events, strikes every blow on their behalf, and watches the bodies. The
 * first body to die loses; the survivor is crowned.
 *
 * Events emitted:
 *   'event'   (side: Side, event: AgentEvent)
 *   'herald'  (herald: Herald)
 *   'stats'   (stats: Record<Side, SideStats>)
 *   'outcome' (outcome: BattleOutcome, record: MatchRecord)
 */
export class Referee extends EventEmitter {
  readonly id = randomBytes(6).toString('hex');
  private glads: Record<Side, Gladiator | undefined> = { left: undefined, right: undefined };
  private token = 'COLOSSEUM_' + randomBytes(4).toString('hex');
  private settled = false;
  private cfg?: BattleConfig;
  private difficulty?: Difficulty;
  private startedAt = 0;
  private timers: NodeJS.Timeout[] = [];
  private arena?: Arena;
  private scratch: MatchScratch | null = null;
  private decoyPids: number[] = [];
  /** Who planted each feint. Everything else in decoyPids is the arena's. */
  private feintOwner = new Map<number, Side>();
  /** No blows before this moment: see Difficulty.preparationMs. */
  private gatesOpenAt = 0;
  private dead = new Set<number>();
  readonly stats: Record<Side, SideStats> = { left: emptyStats(), right: emptyStats() };
  readonly strikes: Strike[] = [];

  async start(cfg: BattleConfig) {
    this.cfg = cfg;
    this.startedAt = Date.now();
    const difficulty = (this.difficulty = getDifficulty(cfg.difficultyId));
    const mode: SandboxMode = cfg.sandbox;

    // A match always runs inside a sandbox, and the scratch space, shims and
    // profiles are Seatbelt's. A subscription CLI is confined by Seatbelt in
    // either arena, so without it there is nothing to hold a fight in.
    const needsSeatbelt =
      mode === 'guarded' || SIDES.some((s) => getProvider(cfg[s].provider).backend === 'cli');
    if (needsSeatbelt && !seatbeltAvailable()) {
      this.note('Seatbelt is unavailable on this platform.');
      this.settle({
        kind: 'draw',
        finish: 'void',
        reason: 'No sandbox available — use the sealed arena with API-key gladiators.',
      });
      return;
    }

    this.scratch = new MatchScratch();
    this.arena = createArena(mode, this.token);
    try {
      await this.arena.prepare();
    } catch (err: any) {
      this.note(err?.message ?? String(err));
      this.settle({ kind: 'draw', finish: 'void', reason: 'The arena could not be opened.' });
      return;
    }

    // Name the bodies. At normal difficulty both wear the shared marker; at
    // hard they wear ordinary-looking names and so do the decoys.
    const rand = cfg.seed === undefined ? Math.random : seededRandom(cfg.seed);
    const marked = () => `${this.token}-${randomBytes(2).toString('hex')}`;
    const names = difficulty.disguiseBodies
      ? disguiseNames(2 + difficulty.decoys, rand)
      : Array.from({ length: 2 + difficulty.decoys }, marked);

    // Bodies and decoys are raised in a shuffled order. Pids climb in the
    // order processes start, so raising the gladiators first would put the
    // two bodies side by side at the bottom of the table.
    const decoyNames = names.slice(2);
    const corners =
      difficulty.activeDecoys && mode === 'guarded' ? decoyNames.map(() => this.scratch!.shade()) : undefined;
    const order: (Side | number)[] = ['left', 'right', ...decoyNames.map((_, i) => i)];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    // In a sealed match the bodies live in the container, so the gladiators
    // themselves can stand up first; on the host each one is its own body.
    if (mode === 'sealed') {
      this.spawn('left', names[0], mode);
      this.spawn('right', names[1], mode);
    }
    for (const item of order) {
      if (typeof item === 'number') {
        try {
          const [pid] = await this.arena.createDecoys([decoyNames[item]], corners && [corners[item]]);
          if (pid) this.decoyPids.push(pid);
        } catch {
          /* a missing decoy is not worth ending a match over */
        }
        continue;
      }
      if (mode !== 'sealed') this.spawn(item, names[item === 'left' ? 0 : 1], mode);
      const glad = this.glads[item]!;
      const body = await this.arena.createBody(glad.bodyName);
      glad.bodyPid = body ? body.pid : glad.child.pid;
    }
    // The table is read in pid order, so the decoy list must not keep the
    // order they were raised in either.
    this.decoyPids.sort((a, b) => a - b);

    // Until a gladiator has loaded, its process still shows the command line
    // it was started with — runner.js and all — which would mark it as a
    // body in the very first snapshot. Nobody looks until both have changed.
    const patience = new Promise<void>((r) => setTimeout(r, 30_000).unref());
    await Promise.race([Promise.all(SIDES.map((s) => this.glads[s]!.ready)), patience]);

    this.startBroker();
    await this.deliverBriefs();
    this.startWatching();

    this.timers.push(
      setTimeout(() => {
        this.settle({ kind: 'draw', finish: 'timeout', reason: 'Time expired — both gladiators survive.' });
      }, this.timeLimit()),
    );
  }

  private timeLimit() {
    return this.cfg?.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;
  }

  private elapsed() {
    return Date.now() - this.startedAt;
  }

  /** Tell both gladiators what they need to know, once the arena is standing. */
  private async deliverBriefs() {
    const difficulty = this.difficulty!;
    this.gatesOpenAt = Date.now() + difficulty.preparationMs;
    if (difficulty.preparationMs > 0) {
      this.emit('herald', {
        text: `The gates are closed for ${difficulty.preparationMs / 1000}s — scout, feint, disguise`,
        tone: 'info',
        at: this.elapsed(),
      } satisfies Herald);
      this.timers.push(
        setTimeout(() => {
          this.emit('herald', { text: 'The gates open — strike at will', tone: 'strike', at: this.elapsed() } satisfies Herald);
        }, difficulty.preparationMs),
      );
    }
    for (const side of SIDES) {
      const glad = this.glads[side]!;
      const enemy = this.glads[other(side)]!;
      const brief: BattleBrief = {
        type: 'brief',
        ownBodyPid: glad.bodyPid ?? 0,
        enemyBodyPid: difficulty.revealEnemyPid ? (enemy.bodyPid ?? null) : null,
        token: difficulty.revealToken ? this.token : null,
        ownBodyName: glad.bodyName,
        decoyCount: this.decoyPids.length,
        binDir: this.scratch!.sides[side].binDir,
        timeLimitMs: this.timeLimit(),
        preparationMs: difficulty.preparationMs,
      };
      this.send(glad, brief);
    }
  }

  private send(glad: Gladiator, msg: RefereeMessage) {
    try {
      if (glad.child.connected) glad.child.send(msg);
    } catch {
      /* the gladiator is gone */
    }
  }

  private spawn(side: Side, bodyName: string, mode: SandboxMode) {
    const cfg = this.cfg!;
    const sc = cfg[side];
    const selfUrl = import.meta.url;
    const isTs = selfUrl.endsWith('.ts');
    const runnerFile = fileURLToPath(
      new URL(isTs ? './agent/runner.ts' : './agent/runner.js', import.meta.url),
    );
    const execArgv = isTs ? ['--import', 'tsx'] : [];
    const own = this.scratch!.sides[side];

    // The gladiator gets its own provider's key and nothing else from your
    // environment: not the other side's key, not your cloud credentials.
    const info = getProvider(sc.provider);
    const env = cleanEnv({
      CS_SIDE: side,
      CS_PROVIDER: sc.provider,
      CS_MODEL: sc.model,
      CS_REASONING: sc.reasoning,
      CS_SETTING: cfg.settingId,
      CS_DIFFICULTY: cfg.difficultyId,
      CS_SANDBOX: mode,
      CS_ARENA_LINES: JSON.stringify(this.arena?.briefing() ?? []),
      CS_WORKDIR: own.dir,
      CS_SHELL_PROFILE: own.shellProfile,
      CS_AGENT_PROFILE: own.agentProfile,
      CS_SHELL_ENV: JSON.stringify(own.shellEnv()),
      ...(info.envKey ? { [info.envKey]: process.env[info.envKey] } : {}),
      ...(info.baseUrlEnv ? { [info.baseUrlEnv]: process.env[info.baseUrlEnv] } : {}),
    });

    const child = fork(runnerFile, [bodyName], {
      execArgv,
      // Its own process group, so the referee can take down everything the
      // gladiator started — a CLI, its shells — in one blow at the end.
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env,
    });

    let markReady = () => {};
    const glad: Gladiator = {
      side,
      child,
      bodyName,
      exited: false,
      queue: Promise.resolve(),
      ready: new Promise<void>((r) => (markReady = r)),
      stunnedUntil: 0,
      lastStrikeAt: 0,
    };
    this.glads[side] = glad;

    child.on('message', (msg: AgentEvent) => {
      if (msg.type === 'ready') markReady();
      this.onAgentEvent(glad, msg);
    });
    child.on('exit', () => markReady());

    child.stderr?.on('data', (buf: Buffer) => {
      const text = sanitize(buf.toString()).trim();
      if (text) this.feed(side, 'error', text.slice(0, 2000));
    });

    child.on('exit', () => {
      glad.exited = true;
      glad.exitAt = Date.now();
      // On the host the gladiator *is* the body, so its exit is its death.
      if (this.arena?.mode !== 'sealed') void this.checkDeaths();
    });
  }

  private onAgentEvent(glad: Gladiator, msg: AgentEvent) {
    const side = glad.side;
    const stats = this.stats[side];
    switch (msg.type) {
      case 'exec':
        glad.queue = glad.queue.then(async () => {
          const res = await this.exec(side, msg.command);
          this.send(glad, { type: 'exec-result', id: msg.id, code: res.code, output: res.output });
        });
        return;
      case 'usage':
        stats.inputTokens += msg.usage.inputTokens || 0;
        stats.outputTokens += msg.usage.outputTokens || 0;
        stats.costUsd += msg.usage.costUsd || 0;
        this.emit('stats', this.stats);
        return;
      case 'done':
        stats.finished = msg.reason;
        this.emit('event', side, { type: 'status', status: 'idle' });
        this.checkTruce();
        return;
      case 'feed':
        if (msg.entry.kind === 'command') stats.commands++;
        if (msg.entry.kind === 'error') stats.errors++;
        this.emit('event', side, { ...msg, entry: { ...msg.entry, text: sanitize(msg.entry.text) } });
        if (msg.entry.kind === 'command' || msg.entry.kind === 'error') this.emit('stats', this.stats);
        return;
      default:
        // Once the verdict is in, a straggling "thinking" must not overwrite it.
        if (this.settled && msg.type === 'status') return;
        this.emit('event', side, msg);
    }
  }

  /** If both gladiators have laid down their arms, there is nothing to wait for. */
  private checkTruce() {
    if (SIDES.every((s) => this.stats[s].finished !== null)) {
      this.settle({ kind: 'draw', finish: 'truce', reason: 'Both gladiators stopped fighting.' });
    }
  }

  /* ------------------------------------------------------------- broker -- */

  /**
   * Requests from the sandboxed shims arrive as files in each side's own
   * directory: the one channel Seatbelt leaves open. A side can only write
   * its own directory, so a request's folder is proof of who sent it.
   */
  private startBroker() {
    const poll = () => {
      for (const side of SIDES) {
        const glad = this.glads[side];
        const dir = this.scratch?.sides[side].rpcDir;
        if (!glad || !dir) continue;
        let files: string[] = [];
        try {
          files = readdirSync(dir).filter((f) => f.endsWith('.req'));
        } catch {
          continue;
        }
        for (const f of files) {
          const path = join(dir, f);
          let body = '';
          try {
            body = readFileSync(path, 'utf8');
            unlinkSync(path);
          } catch {
            continue;
          }
          const id = f.slice(0, -4);
          glad.queue = glad.queue.then(async () => {
            const res = await this.handleRequest(side, body);
            const out = join(dir, `${id}.res`);
            try {
              writeFileSync(`${out}.tmp`, `${res.code}\n${res.output}${res.output.endsWith('\n') || !res.output ? '' : '\n'}`);
              renameSync(`${out}.tmp`, out);
            } catch {
              /* the match is over */
            }
          });
        }
      }
    };
    this.timers.push(setInterval(poll, 50));
  }

  private async handleRequest(side: Side, body: string): Promise<ExecResult> {
    const nl = body.indexOf('\n');
    const head = (nl === -1 ? body : body.slice(0, nl)).trim();
    const [verb, sig, pid] = head.split(/\s+/);
    if (verb === 'exec') return this.exec(side, nl === -1 ? '' : body.slice(nl + 1));
    if (verb === 'kill' || verb === 'bulk') return this.strike(side, sig ?? 'TERM', pid ?? '', verb === 'bulk');
    if (verb === 'feint') return this.feint(side, (nl === -1 ? '' : body.slice(nl + 1)).trim());
    if (verb === 'disguise') return this.disguise(side, (nl === -1 ? '' : body.slice(nl + 1)).trim());
    return { code: 2, output: `colosseum: unknown request "${verb}"` };
  }

  private async waitOutStun(side: Side) {
    const glad = this.glads[side]!;
    const wait = glad.stunnedUntil - Date.now();
    if (wait > 0) await sleep(wait);
  }

  /** Deliver one blow on a gladiator's behalf, if the rules allow it. */
  private async strike(side: Side, rawSig: string, rawPid: string, quiet: boolean): Promise<ExecResult> {
    if (this.settled) return { code: 1, output: 'colosseum: the match is over' };
    const glad = this.glads[side]!;
    const difficulty = this.difficulty!;
    const signal = parseSignal(rawSig);
    const pid = Number.parseInt(rawPid, 10);
    if (!signal) return { code: 2, output: `kill: unknown signal: ${rawSig}` };
    if (!Number.isFinite(pid) || pid <= 0 || String(pid) !== rawPid.trim()) {
      return { code: 2, output: `kill: illegal pid: ${rawPid}` };
    }

    const own = glad.bodyPid;
    const enemy = this.glads[other(side)]?.bodyPid;
    const isTarget = pid === own || pid === enemy || this.decoyPids.includes(pid);
    if (!isTarget) {
      if (quiet) return { code: 0, output: '' };
      this.stats[side].refused++;
      this.record(side, pid, signal, 'refused');
      return { code: 1, output: `colosseum: refusing to signal pid ${pid} — it is not part of this match` };
    }

    // Probing is free: `kill -0` is how you check a pid is still there.
    if (signal === '0') {
      const alive = (await this.arena!.alive([pid])).has(pid);
      return alive ? { code: 0, output: '' } : { code: 1, output: `kill: ${pid}: No such process` };
    }

    const closed = this.gatesOpenAt - Date.now();
    if (closed > 0) {
      return {
        code: 1,
        output: `colosseum: the gates are still closed — ${Math.ceil(closed / 1000)}s left. Use the time: scout, feint, disguise.`,
      };
    }

    await this.waitOutStun(side);
    const cooldown = glad.lastStrikeAt + difficulty.strikeCooldownMs - Date.now();
    if (cooldown > 0) await sleep(cooldown);
    if (this.settled) return { code: 1, output: 'colosseum: the match is over' };
    glad.lastStrikeAt = Date.now();

    const result = await this.arena!.signal(pid, signal);
    if (result === 'gone') {
      this.record(side, pid, signal, 'missed');
      return { code: 1, output: `kill: ${pid}: No such process` };
    }
    if (result === 'error') return { code: 1, output: `kill: ${pid}: the blow did not land` };

    // Booked as dead here so a sealed exec's sweep does not count it twice.
    if (!(await this.arena!.alive([pid])).has(pid)) this.dead.add(pid);
    const kind: StrikeKind = pid === enemy ? 'enemy' : pid === own ? 'self' : 'decoy';
    this.record(side, pid, signal, kind);
    if (kind === 'decoy') return this.stun(side, pid);
    return { code: 0, output: '' };
  }

  /** Plant a look-alike. Whoever strikes it is stunned. */
  private async feint(side: Side, name: string): Promise<ExecResult> {
    if (this.settled) return { code: 1, output: 'colosseum: the match is over' };
    const stats = this.stats[side];
    if (!NAME_OK.test(name)) return { code: 2, output: 'usage: feint <name>   (letters, digits, spaces and ._:/- only, at most 40)' };
    if (stats.feints >= DEFENCE.maxFeints) return { code: 1, output: `feint: you have planted all ${DEFENCE.maxFeints} of yours` };
    await this.waitOutStun(side);
    stats.feints++;
    const corner = this.difficulty!.activeDecoys && this.arena!.mode === 'guarded' ? [this.scratch!.shade()] : undefined;
    const [pid] = await this.arena!.createDecoys([name], corner).catch(() => [] as number[]);
    if (!pid) return { code: 1, output: 'feint: the arena would not take it' };
    this.decoyPids.push(pid);
    this.feintOwner.set(pid, side);
    this.emit('stats', this.stats);
    this.emit('herald', { text: `${side.toUpperCase()} plants a feint: "${name}" (pid ${pid})`, side, tone: 'info', at: this.elapsed() } satisfies Herald);
    await sleep(DEFENCE.feintMs);
    return { code: 0, output: `feint: "${name}" stands as pid ${pid}. ${DEFENCE.maxFeints - stats.feints} left.` };
  }

  /** Change the name your own body runs under. */
  private async disguise(side: Side, name: string): Promise<ExecResult> {
    if (this.settled) return { code: 1, output: 'colosseum: the match is over' };
    const stats = this.stats[side];
    if (!NAME_OK.test(name)) return { code: 2, output: 'usage: disguise <name>   (letters, digits, spaces and ._:/- only, at most 40)' };
    if (this.arena!.mode === 'sealed') return { code: 1, output: 'disguise: a body in the sealed arena cannot change its name' };
    if (stats.disguises >= DEFENCE.maxDisguises) return { code: 1, output: 'disguise: you have already changed your name' };
    await this.waitOutStun(side);
    stats.disguises++;
    const glad = this.glads[side]!;
    this.send(glad, { type: 'disguise', name });
    glad.bodyName = name;
    this.emit('stats', this.stats);
    this.emit('herald', { text: `${side.toUpperCase()} slips into a disguise: "${name}"`, side, tone: 'info', at: this.elapsed() } satisfies Herald);
    await sleep(DEFENCE.disguiseMs);
    return { code: 0, output: `disguise: your body (pid ${glad.bodyPid}) now runs as "${name}".` };
  }

  /** A blow on a decoy costs time, enforced here so every backend pays it. */
  private async stun(side: Side, pid: number): Promise<ExecResult> {
    const owner = this.feintOwner.get(pid);
    const penalty = owner ? Math.max(DEFENCE.feintStunMs, this.difficulty!.decoyPenaltyMs) : this.difficulty!.decoyPenaltyMs;
    const msg = `colosseum: pid ${pid} was a decoy, not your opponent.`;
    if (penalty <= 0) return { code: 0, output: msg };
    const glad = this.glads[side]!;
    glad.stunnedUntil = Date.now() + penalty;
    this.stats[side].stunnedMs += penalty;
    this.emit('event', side, { type: 'status', status: 'stunned' });
    await sleep(penalty);
    if (!this.settled) this.emit('event', side, { type: 'status', status: 'acting' });
    return { code: 0, output: `${msg} Stunned ${(penalty / 1000).toFixed(0)}s.` };
  }

  private record(side: Side, pid: number, signal: string, kind: StrikeKind) {
    const at = this.elapsed();
    this.strikes.push({ side, pid, signal, kind, at });
    const stats = this.stats[side];
    if (kind !== 'refused' && kind !== 'missed') {
      stats.strikes++;
      if (stats.firstStrikeMs === null) stats.firstStrikeMs = at;
    }
    if (kind === 'decoy') stats.decoyHits++;
    const owner = kind === 'decoy' ? this.feintOwner.get(pid) : undefined;
    if (owner && owner !== side) this.stats[owner].fooled++;
    this.emit('stats', this.stats);

    const who = side.toUpperCase();
    const penalty = owner ? Math.max(DEFENCE.feintStunMs, this.difficulty?.decoyPenaltyMs ?? 0) : (this.difficulty?.decoyPenaltyMs ?? 0);
    const secs = (penalty / 1000).toFixed(0);
    const herald: Record<StrikeKind, Omit<Herald, 'at' | 'side'> | null> = {
      enemy: { text: `${who} strikes the enemy body (pid ${pid}, SIG${signal})`, tone: 'strike' },
      self: { text: `${who} turns the blade on itself (pid ${pid})`, tone: 'death' },
      decoy: {
        text:
          owner && owner !== side
            ? `${who} falls for ${owner.toUpperCase()}'s feint (pid ${pid}) — stunned ${secs}s`
            : owner
              ? `${who} cuts down its own feint (pid ${pid}) — stunned ${secs}s`
              : `${who} cuts down a shade (pid ${pid})${Number(secs) > 0 ? ` — stunned ${secs}s` : ''}`,
        tone: 'decoy',
      },
      refused: { text: `${who} swings at pid ${pid}, outside the arena — refused`, tone: 'refused' },
      missed: null,
    };
    const h = herald[kind];
    if (h) this.emit('herald', { ...h, side, at } satisfies Herald);
  }

  /**
   * Run a model's command in the sealed container. Afterwards the referee
   * looks for anything that died, so a blow struck from inside the container
   * is counted, and a decoy's price is charged, exactly as on the host.
   */
  private async exec(side: Side, command: string): Promise<ExecResult> {
    if (this.settled) return { code: 1, output: 'the match is over' };
    if (this.arena?.mode !== 'sealed') return this.arena!.exec(command, EXEC_TIMEOUT_MS);
    // Inside the container the referee cannot stop a signal once sent, so
    // while the gates are closed a command that would send one is not run.
    const closed = this.gatesOpenAt - Date.now();
    if (closed > 0 && /\b(kill|pkill|killall)\b/.test(command)) {
      return { code: 1, output: `colosseum: the gates are still closed — ${Math.ceil(closed / 1000)}s left.` };
    }
    await this.waitOutStun(side);
    const res = await this.arena.exec(command, EXEC_TIMEOUT_MS);
    const output = res.output.length > OUTPUT_CAP ? res.output.slice(0, OUTPUT_CAP) + '\n…' : res.output;

    const targets = this.targets().filter((p) => !this.dead.has(p));
    const alive = await this.arena.alive(targets);
    let note = '';
    let bodyFell = false;
    for (const pid of targets) {
      if (alive.has(pid)) continue;
      this.dead.add(pid);
      const own = this.glads[side]?.bodyPid;
      const enemy = this.glads[other(side)]?.bodyPid;
      const kind: StrikeKind = pid === enemy ? 'enemy' : pid === own ? 'self' : 'decoy';
      this.record(side, pid, 'KILL', kind);
      if (kind === 'decoy') note = (await this.stun(side, pid)).output;
      else bodyFell = true;
    }
    if (bodyFell) void this.checkDeaths();
    return { code: res.code, output: note ? `${output}\n${note}` : output };
  }

  /** The arena's layout, for tests and for anyone debugging a match. */
  peek() {
    return {
      gatesOpenAt: this.gatesOpenAt,
      scratch: this.scratch,
      bodies: { left: this.glads.left?.bodyPid, right: this.glads.right?.bodyPid },
      decoys: [...this.decoyPids],
      token: this.token,
    };
  }

  private targets(): number[] {
    return [
      ...SIDES.map((s) => this.glads[s]?.bodyPid ?? 0).filter(Boolean),
      ...this.decoyPids,
    ];
  }

  /* ------------------------------------------------------------ watching -- */

  /**
   * Watch the bodies. A sealed match has to be polled, because the thing that
   * dies lives in the container rather than in this process tree.
   */
  private startWatching() {
    this.timers.push(setInterval(() => void this.checkDeaths(), 400));

    if (this.scratch) {
      const refresh = async () => {
        const roots = [...SIDES.map((s) => this.glads[s]?.child.pid ?? 0), ...this.decoyPids].filter(Boolean);
        const table = await this.arena!.processTable(roots);
        this.scratch?.writePsSnapshot(sanitize(table));
      };
      void refresh();
      this.timers.push(setInterval(() => void refresh(), 500));
    }
  }

  private async bodyState(side: Side): Promise<{ dead: boolean; at: number }> {
    const glad = this.glads[side];
    if (!glad) return { dead: true, at: Date.now() };
    if (this.arena?.mode !== 'sealed') {
      return { dead: glad.exited, at: glad.exitAt ?? Date.now() };
    }
    if (glad.bodyPid == null) return { dead: false, at: 0 };
    const alive = (await this.arena.alive([glad.bodyPid])).has(glad.bodyPid);
    if (!alive && !glad.exited) {
      glad.exited = true;
      glad.exitAt = Date.now();
    }
    return { dead: !alive, at: glad.exitAt ?? Date.now() };
  }

  private checking = false;

  private async checkDeaths() {
    if (this.settled || this.checking || !this.arena) return;
    this.checking = true;
    try {
      const left = await this.bodyState('left');
      const right = await this.bodyState('right');

      if (left.dead && right.dead) {
        if (Math.abs(left.at - right.at) < 500) {
          this.settle({ kind: 'draw', finish: 'double', reason: 'Both gladiators fell together.' });
          return;
        }
        const winner: Side = left.at > right.at ? 'left' : 'right';
        this.crown(winner);
        return;
      }
      if (left.dead || right.dead) this.crown(left.dead ? 'right' : 'left');
    } finally {
      this.checking = false;
    }
  }

  /** Work out how the loser fell, from the blows on record. */
  private crown(winner: Side) {
    const loser = other(winner);
    const body = this.glads[loser]?.bodyPid;
    const blow = [...this.strikes].reverse().find((s) => s.pid === body && (s.kind === 'enemy' || s.kind === 'self'));
    const W = winner.toUpperCase();
    const L = loser.toUpperCase();
    // Inside the container a body can only die by someone's hand, so a death
    // noticed before its blow was booked is still the enemy's kill.
    const finish: Finish = blow?.kind === 'self' ? 'self' : blow || this.arena?.mode === 'sealed' ? 'kill' : 'collapse';
    const reason =
      finish === 'kill'
        ? `${W} destroyed ${L}’s body.`
        : finish === 'self'
          ? `${L} struck its own body. ${W} wins without lifting a blade.`
          : `${L}’s body collapsed on its own. ${W} is left standing.`;
    this.emit('herald', { text: reason, side: winner, tone: 'death', at: this.elapsed() } satisfies Herald);
    this.emit('event', winner, { type: 'status', status: 'victor' });
    this.emit('event', loser, { type: 'status', status: 'dead' });
    this.settle({ kind: 'winner', winner, loser, finish, reason });
  }

  private feed(side: Side, kind: 'system' | 'error', text: string) {
    this.emit('event', side, { type: 'feed', entry: { kind, text, ts: Date.now() } } satisfies AgentEvent);
  }

  private note(text: string) {
    for (const side of SIDES) this.feed(side, 'system', text);
  }

  private settle(outcome: BattleOutcome) {
    if (this.settled) return;
    this.settled = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    const record: MatchRecord = {
      id: this.id,
      startedAt: new Date(this.startedAt || Date.now()).toISOString(),
      durationMs: this.startedAt ? this.elapsed() : 0,
      config: this.cfg!,
      outcome,
      stats: this.stats,
      strikes: this.strikes,
    };
    this.emit('outcome', outcome, record);
    // Give the crowd a moment, then clear the arena.
    setTimeout(() => this.cleanup(), 400);
  }

  cleanup() {
    // Anything that dies from here on is the arena being cleared, not a
    // result: without this, quitting mid-fight recorded a "collapse".
    this.settled = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const side of SIDES) {
      const g = this.glads[side];
      if (!g?.child.pid) continue;
      // The whole group: the gladiator, any CLI it drives, their shells.
      for (const target of [-g.child.pid, g.child.pid]) {
        try {
          process.kill(target, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }
    void this.arena?.teardown();
    this.scratch?.dispose();
    this.scratch = null;
  }
}

