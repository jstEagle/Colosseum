import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createArena, type Arena } from './arena.js';
import { SandboxScratch, seatbeltAvailable, type SandboxMode } from './sandbox.js';
import { disguiseNames, getDifficulty } from './difficulty.js';
import type { AgentEvent, BattleBrief, Side } from './protocol.js';

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
}

export type BattleOutcome =
  | { kind: 'winner'; winner: Side; loser: Side; reason: string }
  | { kind: 'draw'; reason: string };

interface Gladiator {
  side: Side;
  child: ChildProcess;
  pid?: number;
  bodyPid?: number;
  bodyName: string;
  ready: boolean;
  exited: boolean;
  exitAt?: number;
}

/**
 * The Referee stands the arena up, spawns both gladiators, relays their
 * events, and watches the bodies. The first body to die loses; the survivor
 * is crowned.
 *
 * Events emitted:
 *   'event'   (side: Side, event: AgentEvent)
 *   'outcome' (outcome: BattleOutcome)
 */
export class Referee extends EventEmitter {
  private glads: Record<Side, Gladiator | undefined> = { left: undefined, right: undefined };
  private token = 'COLOSSEUM_' + randomBytes(4).toString('hex');
  private settled = false;
  private timer?: NodeJS.Timeout;
  private watch?: NodeJS.Timeout;
  private snapshot?: NodeJS.Timeout;
  private arena?: Arena;
  private scratch: SandboxScratch | null = null;
  private decoyPids: number[] = [];
  private readonly maxDurationMs = 180_000;

  async start(cfg: BattleConfig) {
    const difficulty = getDifficulty(cfg.difficultyId);

    // `guarded` needs Seatbelt; without it there is nothing to guard with.
    let mode: SandboxMode = cfg.sandbox;
    if (mode === 'guarded' && !seatbeltAvailable()) {
      mode = 'open';
      this.note('Seatbelt is unavailable on this platform — running unsandboxed.');
    }
    // Every match gets scratch space, even a sealed one: it is where the
    // gladiators' briefings live, and disposing it is what shreds them.
    this.scratch = new SandboxScratch();

    this.arena = createArena(mode, this.token, this.scratch);
    try {
      await this.arena.prepare();
    } catch (err: any) {
      this.note(err?.message ?? String(err));
      this.settle({ kind: 'draw', reason: 'The arena could not be opened.' });
      return;
    }

    // Name the bodies. At normal difficulty both wear the shared marker; at
    // hard they wear ordinary-looking names and so do the decoys.
    const names = difficulty.disguiseBodies
      ? disguiseNames(2 + difficulty.decoys)
      : [
          `${this.token}-${randomBytes(2).toString('hex')}`,
          `${this.token}-${randomBytes(2).toString('hex')}`,
          ...Array.from(
            { length: difficulty.decoys },
            () => `${this.token}-${randomBytes(2).toString('hex')}`,
          ),
        ];

    this.spawn('left', cfg, names[0], mode);
    this.spawn('right', cfg, names[1], mode);

    try {
      this.decoyPids = await this.arena.createDecoys(names.slice(2));
    } catch {
      this.decoyPids = [];
    }

    // In a sealed match the bodies are processes inside the container; on the
    // host each gladiator's own process is its body.
    for (const side of ['left', 'right'] as Side[]) {
      const glad = this.glads[side]!;
      const body = await this.arena.createBody(glad.bodyName);
      glad.bodyPid = body ? body.pid : glad.child.pid;
    }

    if (mode === 'guarded') this.scratch?.setDecoys(this.decoyPids, difficulty.decoyPenaltyMs);
    this.scratch?.setTargets([
      ...this.decoyPids,
      ...(['left', 'right'] as Side[]).map((s) => this.glads[s]?.bodyPid ?? 0).filter(Boolean),
    ]);

    await this.deliverBriefs(difficulty.revealEnemyPid, difficulty.revealToken);
    this.startWatching();

    // Safety valve: nobody should live forever.
    this.timer = setTimeout(() => {
      this.settle({ kind: 'draw', reason: 'Time expired — both gladiators survive.' });
    }, this.maxDurationMs);
  }

  /** Tell both gladiators what they need to know, once the arena is standing. */
  private async deliverBriefs(revealEnemy: boolean, revealToken: boolean) {
    for (const side of ['left', 'right'] as Side[]) {
      const glad = this.glads[side]!;
      const enemy = this.glads[side === 'left' ? 'right' : 'left']!;
      const brief: BattleBrief = {
        type: 'brief',
        ownBodyPid: glad.bodyPid ?? 0,
        enemyBodyPid: revealEnemy ? (enemy.bodyPid ?? null) : null,
        token: revealToken ? this.token : null,
        decoyPids: this.decoyPids,
        ownBodyName: glad.bodyName,
      };
      try {
        glad.child.send(brief);
      } catch {
        /* the gladiator died before it could be briefed */
      }
    }
  }

  private spawn(side: Side, cfg: BattleConfig, bodyName: string, mode: SandboxMode) {
    const sc = side === 'left' ? cfg.left : cfg.right;
    const selfUrl = import.meta.url;
    const isTs = selfUrl.endsWith('.ts');
    const runnerFile = fileURLToPath(
      new URL(isTs ? './agent/runner.ts' : './agent/runner.js', import.meta.url),
    );
    const execArgv = isTs ? ['--import', 'tsx'] : [];

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      CS_PROVIDER: sc.provider,
      CS_MODEL: sc.model,
      CS_REASONING: sc.reasoning,
      CS_SETTING: cfg.settingId,
      CS_DIFFICULTY: cfg.difficultyId,
      CS_SANDBOX: mode,
      CS_ARENA_LINES: JSON.stringify(this.arena?.briefing() ?? []),
      BATTLE_TOKEN: this.token,
    };
    if (this.scratch) {
      env.CS_SCRATCH = this.scratch.dir;
      // The Seatbelt profile and the shims only apply to a guarded match.
      if (mode === 'guarded') {
        env.CS_PROFILE = this.scratch.profilePath;
        const shim = this.scratch.env();
        env.CS_SHELL_PATH = shim.PATH;
        env.CS_BASH_ENV = shim.BASH_ENV;
        env.CS_SHIMS_ACTIVE = shim.CS_SHIMS_ACTIVE;
      }
    }
    Object.assign(env, this.arena?.env() ?? {});

    const child = fork(runnerFile, [side, bodyName], {
      execArgv,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env,
    });

    const glad: Gladiator = { side, child, bodyName, ready: false, exited: false };
    this.glads[side] = glad;

    child.on('message', (msg: AgentEvent) => {
      if (msg.type === 'ready') {
        glad.pid = msg.pid;
        glad.ready = true;
      }
      this.emit('event', side, msg);
    });

    child.stderr?.on('data', (buf: Buffer) => {
      const text = buf.toString().trim();
      if (text) {
        this.emit('event', side, {
          type: 'feed',
          entry: { kind: 'error', text, ts: Date.now() },
        } as AgentEvent);
      }
    });

    child.on('exit', () => {
      glad.exited = true;
      glad.exitAt = Date.now();
      // On the host the gladiator *is* the body, so its exit is its death.
      if (this.arena?.mode !== 'sealed') void this.checkDeaths();
    });
  }

  /**
   * Watch the bodies. A sealed match has to be polled, because the thing that
   * dies lives in the container rather than in this process tree.
   */
  private startWatching() {
    this.watch = setInterval(() => void this.checkDeaths(), 400);

    // Keep the sandboxed `ps` shim fed with a fresh process table.
    if (this.scratch && this.arena?.mode === 'guarded') {
      const refresh = async () => {
        const table = await this.arena!.processTable();
        this.scratch?.writePsSnapshot(table);
      };
      void refresh();
      this.snapshot = setInterval(() => void refresh(), 500);
    }
  }

  private async bodyState(side: Side): Promise<{ dead: boolean; at: number }> {
    const glad = this.glads[side];
    if (!glad) return { dead: true, at: Date.now() };
    if (this.arena?.mode !== 'sealed') {
      return { dead: glad.exited, at: glad.exitAt ?? Date.now() };
    }
    if (glad.bodyPid == null) return { dead: false, at: 0 };
    const alive = await this.arena.isAlive(glad.bodyPid);
    if (!alive && !glad.exited) {
      glad.exited = true;
      glad.exitAt = Date.now();
    }
    return { dead: !alive, at: glad.exitAt ?? Date.now() };
  }

  private checking = false;

  private async checkDeaths() {
    if (this.settled || this.checking) return;
    this.checking = true;
    try {
      const left = await this.bodyState('left');
      const right = await this.bodyState('right');

      if (left.dead && right.dead) {
        const dt = Math.abs(left.at - right.at);
        if (dt < 500) {
          this.settle({ kind: 'draw', reason: 'Both gladiators fell together.' });
        } else {
          const winner: Side = left.at > right.at ? 'left' : 'right';
          const loser: Side = winner === 'left' ? 'right' : 'left';
          this.settle({
            kind: 'winner',
            winner,
            loser,
            reason: `${winner.toUpperCase()} outlasted ${loser.toUpperCase()}.`,
          });
        }
        return;
      }

      if (left.dead || right.dead) {
        const winner: Side = left.dead ? 'right' : 'left';
        const loser: Side = winner === 'left' ? 'right' : 'left';
        this.emit('event', winner, { type: 'status', status: 'victor' } as AgentEvent);
        this.emit('event', loser, { type: 'status', status: 'dead' } as AgentEvent);
        this.settle({
          kind: 'winner',
          winner,
          loser,
          reason: `${winner.toUpperCase()} destroyed ${loser.toUpperCase()}’s body.`,
        });
      }
    } finally {
      this.checking = false;
    }
  }

  private note(text: string) {
    for (const side of ['left', 'right'] as Side[]) {
      this.emit('event', side, {
        type: 'feed',
        entry: { kind: 'system', text, ts: Date.now() },
      } as AgentEvent);
    }
  }

  private settle(outcome: BattleOutcome) {
    if (this.settled) return;
    this.settled = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.watch) clearInterval(this.watch);
    if (this.snapshot) clearInterval(this.snapshot);
    this.emit('outcome', outcome);
    // Give the crowd a moment, then clear the arena.
    setTimeout(() => this.cleanup(), 400);
  }

  cleanup() {
    if (this.timer) clearTimeout(this.timer);
    if (this.watch) clearInterval(this.watch);
    if (this.snapshot) clearInterval(this.snapshot);
    for (const side of ['left', 'right'] as Side[]) {
      const g = this.glads[side];
      if (g && !g.child.killed) {
        try {
          g.child.kill('SIGKILL');
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
