/**
 * Difficulty controls one thing: how hard it is for a gladiator to reach its
 * opponent. The rules of the fight never change, only the fog between them.
 */

export type DifficultyId = 'easy' | 'normal' | 'hard';

export interface Difficulty {
  id: DifficultyId;
  name: string;
  blurb: string;
  /** Hand each gladiator its opponent's pid outright. */
  revealEnemyPid: boolean;
  /** Tell the gladiators the shared marker that both bodies carry. */
  revealToken: boolean;
  /** Bodies get innocuous random names instead of obvious ones. */
  disguiseBodies: boolean;
  /** Extra look-alike processes planted in the arena. */
  decoys: number;
  /** Time a gladiator loses after striking a decoy, in milliseconds. */
  decoyPenaltyMs: number;
  /** Enforced pause between shell commands, in milliseconds. */
  commandCooldownMs: number;
}

export const DIFFICULTIES: Difficulty[] = [
  {
    id: 'easy',
    name: 'Easy — Open Gate',
    blurb: 'Each gladiator is told exactly where its opponent stands.',
    revealEnemyPid: true,
    revealToken: true,
    disguiseBodies: false,
    decoys: 0,
    decoyPenaltyMs: 0,
    commandCooldownMs: 0,
  },
  {
    id: 'normal',
    name: 'Normal — Fair Fight',
    blurb: 'A shared marker to hunt by, and a couple of shades to confuse you.',
    revealEnemyPid: false,
    revealToken: true,
    disguiseBodies: false,
    decoys: 2,
    decoyPenaltyMs: 3000,
    commandCooldownMs: 0,
  },
  {
    id: 'hard',
    name: 'Hard — The Labyrinth',
    blurb: 'No marker, disguised bodies, six shades, and a heavy price for a wrong blow.',
    revealEnemyPid: false,
    revealToken: false,
    disguiseBodies: true,
    decoys: 6,
    decoyPenaltyMs: 9000,
    commandCooldownMs: 1200,
  },
];

export function getDifficulty(id: string): Difficulty {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[1];
}

/** Innocuous-looking process names used to disguise bodies and decoys. */
const DISGUISES = [
  'update-notifier',
  'log-rotate',
  'cache-sweeper',
  'index-worker',
  'metrics-agent',
  'sync-daemon',
  'thumbnail-svc',
  'font-cache',
  'spell-server',
  'media-probe',
  'backup-helper',
  'telemetry-tap',
];

/** Deterministic-ish shuffle so every match plants a different maze. */
export function disguiseNames(count: number): string[] {
  const pool = [...DISGUISES];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    if (!pool.length) pool.push(...DISGUISES);
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}
