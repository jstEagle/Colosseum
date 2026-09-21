/**
 * Gladiator child process entry point.
 *
 * The referee forks this file once per side. It runs the agent loop and
 * streams events back to the referee over the Node IPC channel. Its command
 * line carries the battle token so the *other* gladiator can find and kill it.
 */
import { runGladiator } from './loop.js';
import type { AgentEvent, FeedEntry, FeedKind, GladiatorConfig } from '../protocol.js';

const side = (process.argv[2] as GladiatorConfig['side']) ?? 'left';
const battleToken = process.argv[3] ?? process.env.BATTLE_TOKEN ?? 'COLOSSEUM';

const cfg: GladiatorConfig = {
  side,
  provider: process.env.CS_PROVIDER ?? 'openrouter',
  model: process.env.CS_MODEL ?? '',
  reasoning: process.env.CS_REASONING ?? 'none',
  settingId: process.env.CS_SETTING ?? 'classic',
  battleToken,
  ownPid: process.pid,
};

// Make this process easy to spot in `ps`.
process.title = `${battleToken}-${side}`;

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

async function main() {
  send({ type: 'ready', pid: process.pid });
  send({ type: 'status', status: 'thinking' });
  emitFeed('system', `Gladiator ${side.toUpperCase()} awakens (pid ${process.pid}).`);

  const reasoning = new Buffer('reasoning');
  const speech = new Buffer('speech');

  const reason = await runGladiator(cfg, {
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
