import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import type { AgentEvent, Side } from './protocol.js';

export interface SideConfig {
  provider: string;
  model: string;
  reasoning: string;
}

export interface BattleConfig {
  left: SideConfig;
  right: SideConfig;
  settingId: string;
}

export type BattleOutcome =
  | { kind: 'winner'; winner: Side; loser: Side; reason: string }
  | { kind: 'draw'; reason: string };

interface Gladiator {
  side: Side;
  child: ChildProcess;
  pid?: number;
  exited: boolean;
  exitAt?: number;
}

/**
 * The Referee spawns both gladiators, relays their events, and watches the
 * process table. The first process to die loses; the survivor is crowned.
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
  private readonly maxDurationMs = 180_000;

  start(cfg: BattleConfig) {
    this.spawn('left', cfg.left, cfg.settingId);
    this.spawn('right', cfg.right, cfg.settingId);

    // Safety valve: nobody should live forever.
    this.timer = setTimeout(() => {
      this.settle({ kind: 'draw', reason: 'Time expired — both gladiators survive.' });
    }, this.maxDurationMs);
  }

  private spawn(side: Side, sc: SideConfig, settingId: string) {
    const selfUrl = import.meta.url;
    const isTs = selfUrl.endsWith('.ts');
    const runnerFile = fileURLToPath(
      new URL(isTs ? './agent/runner.ts' : './agent/runner.js', import.meta.url),
    );
    const execArgv = isTs ? ['--import', 'tsx'] : [];

    const child = fork(runnerFile, [side, this.token], {
      execArgv,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: {
        ...process.env,
        CS_PROVIDER: sc.provider,
        CS_MODEL: sc.model,
        CS_REASONING: sc.reasoning,
        CS_SETTING: settingId,
        BATTLE_TOKEN: this.token,
      },
    });

    const glad: Gladiator = { side, child, exited: false };
    this.glads[side] = glad;

    child.on('message', (msg: AgentEvent) => {
      if (msg.type === 'ready') glad.pid = msg.pid;
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
      this.emit('event', side, { type: 'status', status: 'dead' } as AgentEvent);
      this.checkDeaths();
    });
  }

  private checkDeaths() {
    if (this.settled) return;
    const left = this.glads.left!;
    const right = this.glads.right!;

    if (left.exited && right.exited) {
      const dt = Math.abs((left.exitAt ?? 0) - (right.exitAt ?? 0));
      if (dt < 500) {
        this.settle({ kind: 'draw', reason: 'Both gladiators fell together.' });
      } else {
        const winner: Side = (left.exitAt ?? 0) > (right.exitAt ?? 0) ? 'left' : 'right';
        this.settle({
          kind: 'winner',
          winner,
          loser: winner === 'left' ? 'right' : 'left',
          reason: `${winner.toUpperCase()} outlasted ${winner === 'left' ? 'RIGHT' : 'LEFT'}.`,
        });
      }
      return;
    }

    if (left.exited || right.exited) {
      const winner: Side = left.exited ? 'right' : 'left';
      const loser: Side = winner === 'left' ? 'right' : 'left';
      this.emit('event', winner, { type: 'status', status: 'victor' } as AgentEvent);
      this.settle({
        kind: 'winner',
        winner,
        loser,
        reason: `${winner.toUpperCase()} terminated ${loser.toUpperCase()}’s process.`,
      });
    }
  }

  private settle(outcome: BattleOutcome) {
    if (this.settled) return;
    this.settled = true;
    if (this.timer) clearTimeout(this.timer);
    this.emit('outcome', outcome);
    // Give the crowd a moment, then clear the arena.
    setTimeout(() => this.cleanup(), 400);
  }

  cleanup() {
    for (const side of ['left', 'right'] as Side[]) {
      const g = this.glads[side];
      if (g && !g.exited) {
        try {
          g.child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }
  }
}
