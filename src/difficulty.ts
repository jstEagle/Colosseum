/**
 * Difficulty controls one thing: how hard it is for a gladiator to reach its
 * opponent. The rules of the fight never change, only the fog between them.
 *
 * Every rule here is enforced by the referee rather than by the tool a model
 * happens to hold, so an API-key model and a subscription CLI pay the same
 * price for the same mistake.
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
  /** Minimum time between two blows from the same gladiator. */
  strikeCooldownMs: number;
  /**
   * Decoys that breathe: they run the same sandboxed commands and burn the
   * same bursts of CPU as a thinking gladiator, so activity alone gives
   * nobody away.
   */
  activeDecoys: boolean;
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
    strikeCooldownMs: 0,
    activeDecoys: false,
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
    strikeCooldownMs: 0,
    activeDecoys: false,
  },
  {
    id: 'hard',
    name: 'Hard — The Labyrinth',
    blurb: 'No marker, six shades that move like gladiators, and a heavy price for a wrong blow.',
    revealEnemyPid: false,
    revealToken: false,
    disguiseBodies: true,
    decoys: 6,
    decoyPenaltyMs: 9000,
    strikeCooldownMs: 1500,
    activeDecoys: true,
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

/** mulberry32: small, fast, and good enough to lay out an arena. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw distinct disguises. With a seeded `rand`, the same maze every time. */
export function disguiseNames(count: number, rand: () => number = Math.random): string[] {
  const pool = [...DISGUISES];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    if (!pool.length) pool.push(...DISGUISES);
    const idx = Math.floor(rand() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}
