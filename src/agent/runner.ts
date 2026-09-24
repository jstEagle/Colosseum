/**
 * Gladiator child process entry point.
 *
 * The referee forks this file once per side. It waits for the battle brief,
 * runs the agent loop, and streams events back over the Node IPC channel.
 * On the host arena its own process is the body the opponent must destroy.
 */
import { exec } from 'node:child_process';
import { runGladiator, type LoopContext } from './loop.js';
import { seatbeltWrap } from '../sandbox.js';
import type {
  AgentEvent,
  BattleBrief,
  FeedKind,
  GladiatorConfig,
  RefereeMessage,
  Side,
} from '../protocol.js';

// argv carries only the body name, so the process is findable in the process
// table under exactly the name the arena chose for it.
const bodyName = process.argv[2] ?? 'gladiator';
const side = (process.env.CS_SIDE as Side) ?? 'left';

const cfg: GladiatorConfig = {
  side,
  provider: process.env.CS_PROVIDER ?? 'openrouter',
  model: process.env.CS_MODEL ?? '',
  reasoning: process.env.CS_REASONING ?? 'none',
  settingId: process.env.CS_SETTING ?? 'classic',
  difficultyId: process.env.CS_DIFFICULTY ?? 'normal',
  sandboxMode: process.env.CS_SANDBOX ?? 'guarded',
  ownPid: process.pid,
};

process.title = bodyName;

// If the referee goes away, so does everything this gladiator started.
process.on('disconnect', () => {
  try {
    process.kill(-process.pid, 'SIGKILL');
  } catch {
    process.exit(1);
  }
});

function send(event: AgentEvent) {
  try {
    if (process.connected) process.send?.(event);
  } catch {
    /* the referee is gone */
  }
}

function emitFeed(kind: FeedKind, text: string) {
  send({ type: 'feed', entry: { kind, text, ts: Date.now() } });
}

/** Coalesce streamed deltas into readable chunks instead of flooding IPC. */
class LineBuffer {
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
    // Long unbroken streams are cut at a sentence end where possible, so a
    // thought reads as a thought rather than as 160-character shards.
    if (this.buf.length > 320) {
      const cut = Math.max(this.buf.lastIndexOf('. ', 480), this.buf.lastIndexOf('? ', 480));
      const at = cut > 120 ? cut + 1 : this.buf.length > 480 ? 480 : -1;
      if (at > 0) {
        emitFeed(this.kind, this.buf.slice(0, at).trim());
        this.buf = this.buf.slice(at).trimStart();
      }
    }
  }
  flush() {
    if (this.buf.trim()) emitFeed(this.kind, this.buf);
    this.buf = '';
  }
}

/* ------------------------------------------------------------ messages -- */

let briefed: (brief: BattleBrief) => void = () => {};
const brief = new Promise<BattleBrief>((resolve) => (briefed = resolve));
const pendingExec = new Map<number, (out: { code: number; output: string }) => void>();
let execSeq = 0;

// The listener stays for the life of the match: it is also what keeps the
// IPC channel, and so this process, alive once the agent has finished.
process.on('message', (msg: RefereeMessage) => {
  if (msg?.type === 'brief') briefed(msg);
  else if (msg?.type === 'disguise') process.title = msg.name;
  else if (msg?.type === 'exec-result') {
    pendingExec.get(msg.id)?.({ code: msg.code, output: msg.output });
    pendingExec.delete(msg.id);
  }
});

/** In a sealed match the referee runs every command inside the container. */
function execViaReferee(command: string): Promise<string> {
  const id = ++execSeq;
  return new Promise((resolve) => {
    pendingExec.set(id, ({ code, output }) => {
      const out = output.trim();
      resolve(code !== 0 && !out ? `[exit ${code}]` : out || '[no output]');
    });
    send({ type: 'exec', id, command });
  });
}

/** In a guarded match the command runs here, wrapped in Seatbelt. */
function execGuarded(command: string, profile: string, env: Record<string, string>, cwd: string) {
  return new Promise<string>((resolve) => {
    exec(
      seatbeltWrap(profile, command),
      { timeout: 20_000, maxBuffer: 1024 * 1024, killSignal: 'SIGKILL', shell: '/bin/bash', env, cwd },
      (error: any, stdout: string, stderr: string) => {
        const out = `${stdout ?? ''}${stderr ?? ''}`.trim();
        if (error?.killed) return resolve(`${out}\n[timed out after 20s]`.trim());
        if (error && !out) return resolve(`[exit ${error.code ?? 'error'}]`);
        resolve(out || '[no output]');
      },
    );
  });
}

async function main() {
  send({ type: 'ready', pid: process.pid });
  send({ type: 'status', status: 'waiting' });
  emitFeed('system', `Gladiator ${side.toUpperCase()} awakens (pid ${process.pid}).`);

  const b = await brief;
  send({ type: 'status', status: 'thinking' });

  const workDir = process.env.CS_WORKDIR || process.cwd();
  const shellProfile = process.env.CS_SHELL_PROFILE ?? '';
  const shellEnv: Record<string, string> = JSON.parse(process.env.CS_SHELL_ENV ?? '{}');

  const ctx: LoopContext = {
    brief: b,
    arenaLines: JSON.parse(process.env.CS_ARENA_LINES ?? '[]'),
    execute:
      cfg.sandboxMode === 'sealed'
        ? execViaReferee
        : (command) => execGuarded(command, shellProfile, shellEnv, workDir),
    shellEnv,
    agentProfile: process.env.CS_AGENT_PROFILE || null,
    workDir,
  };

  const reasoning = new LineBuffer('reasoning');
  const speech = new LineBuffer('speech');

  const reason = await runGladiator(cfg, ctx, {
    onReasoning: (t) => reasoning.push(t),
    onSpeech: (t) => speech.push(t),
    onCommand: (c) => {
      reasoning.flush();
      speech.flush();
      send({ type: 'status', status: 'acting' });
      emitFeed('command', c);
    },
    onResult: (o) => {
      emitFeed('result', o.length > 600 ? o.slice(0, 600) + '…' : o);
      send({ type: 'status', status: 'thinking' });
    },
    onSystem: (t) => emitFeed('system', t),
    onError: (t) => emitFeed('error', t),
    onUsage: (usage) => send({ type: 'usage', usage }),
  });

  reasoning.flush();
  speech.flush();
  // The gladiator stops fighting, but its body stays standing: running out
  // of ideas is not the same as dying.
  send({ type: 'done', reason });
}

main().catch((err) => {
  emitFeed('error', err?.message ?? String(err));
  send({ type: 'done', reason: 'crash' });
});
