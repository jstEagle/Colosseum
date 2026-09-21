/**
 * Message protocol between the referee (main process) and each gladiator
 * child process. Events flow child -> parent over the Node IPC channel.
 */

export type Side = 'left' | 'right';

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

export type AgentEvent =
  | { type: 'ready'; pid: number }
  | { type: 'status'; status: AgentStatus }
  | { type: 'feed'; entry: FeedEntry }
  | { type: 'killed-opponent'; targetPid: number } // this agent claims a kill
  | { type: 'done'; reason: string }; // loop ended on its own

export type AgentStatus =
  | 'booting'
  | 'thinking'
  | 'acting'
  | 'waiting'
  | 'dead'
  | 'victor';

/** Config handed to a gladiator process via environment variables. */
export interface GladiatorConfig {
  side: Side;
  provider: string;
  model: string;
  reasoning: string;
  settingId: string;
  battleToken: string;
  ownPid: number;
}
