/**
 * Message protocol between the referee (main process) and each gladiator
 * child process. Agent events flow child -> parent; the battle brief and the
 * answers to sealed-arena commands flow parent -> child.
 */

export type Side = 'left' | 'right';

export const SIDES: Side[] = ['left', 'right'];

export const other = (side: Side): Side => (side === 'left' ? 'right' : 'left');

export type FeedKind =
  | 'reasoning' // model's private thinking, streamed
  | 'speech' // model's narration / visible text
  | 'command' // a shell command the model chose to run
  | 'result' // output from a shell command
  | 'system' // referee / harness notices
  | 'error'; // something went wrong

export interface FeedEntry {
  kind: FeedKind;
  text: string;
  ts: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Only the subscription CLIs report a price. */
  costUsd?: number;
}

export type AgentEvent =
  | { type: 'ready'; pid: number }
  | { type: 'status'; status: AgentStatus }
  | { type: 'feed'; entry: FeedEntry }
  | { type: 'usage'; usage: Usage }
  /** A sealed-arena command the referee should run in the container. */
  | { type: 'exec'; id: number; command: string }
  | { type: 'done'; reason: string }; // loop ended on its own

export type AgentStatus =
  | 'booting'
  | 'thinking'
  | 'acting'
  | 'waiting'
  | 'stunned'
  | 'idle'
  | 'dead'
  | 'victor';

/**
 * Sent by the referee once both gladiators exist and the arena is standing.
 * Until it arrives, a gladiator waits: nobody swings at an empty arena.
 */
export interface BattleBrief {
  type: 'brief';
  /** The process this gladiator must defend. */
  ownBodyPid: number;
  /** The opponent's body, when the difficulty gives it away. */
  enemyBodyPid: number | null;
  /** Shared marker both bodies carry, when the difficulty reveals it. */
  token: string | null;
  /** Names the bodies are running under. */
  ownBodyName: string;
  /** How many decoys stand in the arena. */
  decoyCount: number;
  /** Where this side's shims live, so a briefing can name them exactly. */
  binDir: string;
  /** How long the match may last, in milliseconds. */
  timeLimitMs: number;
  /** How long the gates stay closed after this brief: no blows until then. */
  preparationMs: number;
}

export type RefereeMessage =
  | BattleBrief
  | { type: 'exec-result'; id: number; code: number; output: string }
  /** The gladiator asked for its body to run under another name. */
  | { type: 'disguise'; name: string };

/** Config handed to a gladiator process via environment variables. */
export interface GladiatorConfig {
  side: Side;
  provider: string;
  model: string;
  reasoning: string;
  settingId: string;
  difficultyId: string;
  sandboxMode: string;
  ownPid: number;
}

/**
 * Text that reaches the terminal came from a model, or from a process a model
 * named. Escape sequences in it could retitle the window, rewrite the
 * clipboard or worse, so everything but newlines and tabs is stripped.
 */
export function sanitize(text: string): string {
  return text
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)?/g, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
}
