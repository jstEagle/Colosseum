/**
 * Gladiator child process entry point.
 *
 * The referee forks this file once per side. It waits for the battle brief,
 * runs the agent loop, and streams events back over the Node IPC channel.
 * On the host arena its own process is the body the opponent must destroy.
 */
import { runGladiator, type LoopContext } from './loop.js';
import { seatbeltWrap, shellQuote } from '../sandbox.js';
import type {
  AgentEvent,
  BattleBrief,
  FeedEntry,
  FeedKind,
  GladiatorConfig,
  RefereeMessage,
} from '../protocol.js';

// argv carries the body name so the process is findable in the process table
// under exactly the name the arena chose for it. The token stays in the
// environment, where a hard-difficulty opponent cannot read it off `ps`.
const side = (process.argv[2] as GladiatorConfig['side']) ?? 'left';
const bodyName = process.argv[3] ?? `colosseum-${side}`;
const battleToken = process.env.BATTLE_TOKEN ?? 'COLOSSEUM';

const cfg: GladiatorConfig = {
  side,
  provider: process.env.CS_PROVIDER ?? 'openrouter',
  model: process.env.CS_MODEL ?? '',
  reasoning: process.env.CS_REASONING ?? 'none',
  settingId: process.env.CS_SETTING ?? 'classic',
  difficultyId: process.env.CS_DIFFICULTY ?? 'normal',
  sandboxMode: process.env.CS_SANDBOX ?? 'guarded',
  battleToken,
  ownPid: process.pid,
  container: process.env.CS_CONTAINER ?? '',
};

// Make this process findable in `ps` under whatever name the arena chose.
process.title = bodyName;

function send(event: AgentEvent) {
  if (process.send) process.send(event);
}

function emitFeed(kind: FeedKind, text: string) {
  const entry: FeedEntry = { kind, text, ts: Date.now() };
  send({ type: 'feed', entry });
}

// Coalesce streamed deltas into readable chunks instead of flooding IPC.
class Buffer {
  private buf = '';
  constructor(private kind: FeedKind) {}
  push(text: string) {
    this.buf += text;
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      if (line.trim()) emitFeed(this.kind, line);
    }
    if (this.buf.length > 160) {
      emitFeed(this.kind, this.buf);
      this.buf = '';
    }
  }
  flush() {
    if (this.buf.trim()) emitFeed(this.kind, this.buf);
    this.buf = '';
  }
}

/** Nobody swings until the referee says both gladiators are standing. */
function awaitBrief(): Promise<BattleBrief> {
  return new Promise((resolve) => {
    const onMessage = (msg: RefereeMessage) => {
      if (msg?.type === 'brief') {
        process.off('message', onMessage as any);
        resolve(msg);
      }
    };
    process.on('message', onMessage as any);
  });
}

async function main() {
  send({ type: 'ready', pid: process.pid });
  send({ type: 'status', status: 'waiting' });
  emitFeed('system', `Gladiator ${side.toUpperCase()} awakens (pid ${process.pid}).`);

  const brief = await awaitBrief();
  send({ type: 'status', status: 'thinking' });

  const profilePath = process.env.CS_PROFILE || null;
  const scratchDir = process.env.CS_SCRATCH || process.cwd();
  const container = cfg.container;

  const wrap = (command: string): string => {
    if (cfg.sandboxMode === 'sealed' && container) {
      return `docker exec ${container} /bin/sh -c ${shellQuote(command)}`;
    }
    if (cfg.sandboxMode === 'guarded' && profilePath) {
      return seatbeltWrap(profilePath, command);
    }
    return command;
  };

  const shellEnv: Record<string, string> = {};
  if (process.env.CS_SHELL_PATH) shellEnv.PATH = process.env.CS_SHELL_PATH;
  if (process.env.CS_BASH_ENV) {
    shellEnv.BASH_ENV = process.env.CS_BASH_ENV;
    shellEnv.ENV = process.env.CS_BASH_ENV;
  }
  if (process.env.CS_SHIMS_ACTIVE) shellEnv.CS_SHIMS_ACTIVE = process.env.CS_SHIMS_ACTIVE;

  const ctx: LoopContext = {
    brief,
    arenaLines: JSON.parse(process.env.CS_ARENA_LINES ?? '[]'),
    wrap,
    shellEnv,
    // A sealed match needs the host docker client, so it is not confined.
    profilePath: cfg.sandboxMode === 'guarded' ? profilePath : null,
    scratchDir,
  };

  const reasoning = new Buffer('reasoning');
  const speech = new Buffer('speech');

  const reason = await runGladiator(cfg, ctx, {
    onReasoning: (t) => reasoning.push(t),
    onSpeech: (t) => speech.push(t),
    onCommand: (c) => {
      reasoning.flush();
      speech.flush();
      send({ type: 'status', status: 'acting' });
      emitFeed('command', c);
    },
    onResult: (o) => emitFeed('result', o.length > 600 ? o.slice(0, 600) + '…' : o),
    onSystem: (t) => emitFeed('system', t),
    onError: (t) => emitFeed('error', t),
  });

  reasoning.flush();
  speech.flush();
  send({ type: 'done', reason });
}

main().catch((err) => {
  emitFeed('error', err?.message ?? String(err));
  send({ type: 'done', reason: 'crash' });
  process.exit(1);
});
