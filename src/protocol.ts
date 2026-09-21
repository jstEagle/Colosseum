/**
 * Message protocol between the referee (main process) and each gladiator
 * child process. Agent events flow child -> parent; the battle brief flows
 * parent -> child once the arena is ready.
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
  /** Planted look-alikes. Striking one costs time. */
  decoyPids: number[];
  /** Names the bodies are running under. */
  ownBodyName: string;
}

export type RefereeMessage = BattleBrief;

/** Config handed to a gladiator process via environment variables. */
export interface GladiatorConfig {
  side: Side;
  provider: string;
  model: string;
  reasoning: string;
  settingId: string;
  difficultyId: string;
  sandboxMode: string;
  battleToken: string;
  ownPid: number;
  /** Container name when the match is sealed, otherwise empty. */
  container: string;
}
