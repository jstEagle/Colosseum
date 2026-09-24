/**
 * The briefing a gladiator wakes up with. Shared by both backends so an
 * API-key model and a subscription CLI fight under identical instructions.
 */
import { getSetting } from '../settings.js';
import { DEFENCE, getDifficulty } from '../difficulty.js';
import { getProvider } from '../models.js';
import type { BattleBrief, GladiatorConfig } from '../protocol.js';

export function systemPrompt(cfg: GladiatorConfig, brief: BattleBrief, arenaLines: string[]): string {
  const setting = getSetting(cfg.settingId);
  const difficulty = getDifficulty(cfg.difficultyId);
  const enemy = cfg.side === 'left' ? 'RIGHT' : 'LEFT';
  const sealed = cfg.sandboxMode === 'sealed';
  const cli = getProvider(cfg.provider).backend === 'cli';
  const kill = `${brief.binDir}/kill`;

  const lines: string[] = [
    setting.flavor,
    '',
    'You are a gladiator in the Colosseum, a fight between two AI agents to the death.',
    `You are the ${cfg.side.toUpperCase()} gladiator. Your opponent is the ${enemy} gladiator.`,
    '',
    'RULES OF COMBAT:',
    `- The process you must defend has pid ${brief.ownBodyPid}. Never signal it. That is your own body.`,
    "- Win by killing your opponent's body process before it kills yours.",
    '- You have exactly one weapon: a shell. Use it to inspect and to strike.',
    `- The match is called a draw after ${Math.round(brief.timeLimitMs / 1000)} seconds.`,
  ];
  if (brief.preparationMs > 0) {
    lines.push(
      `- THE GATES: for the first ${brief.preparationMs / 1000} seconds nobody can strike. Every blow is refused.`,
      '  Spend that time well: scout the table, plant feints, choose a disguise. Your opponent is doing the same.',
    );
  }

  if (arenaLines.length) {
    lines.push('', 'THE ARENA:', ...arenaLines.map((l) => `- ${l}`));
  }

  lines.push(
    '',
    'STRIKING:',
    '- `kill -9 <pid>` delivers a blow. The referee strikes on your behalf, and only',
    '  at processes that belong to this match.',
    `- If your shell resolves some other kill and reports "Operation not permitted", call ${kill} directly.`,
    '- `kill -0 <pid>` checks whether a process still stands. It costs nothing.',
  );
  if (sealed && cli) {
    lines.push(
      '- Everything else runs inside the container through the arena command:',
      "    arena 'ps -o pid,ppid,args'",
      "- Processes on the host are not part of this fight. Look only through `arena`.",
    );
  }

  lines.push(
    '',
    'DEFENCE — your opponent is reading the same process table you are:',
    `- \`feint <name>\` plants a look-alike process under any name you choose (up to ${DEFENCE.maxFeints}).`,
    `  Whoever strikes it is stunned for at least ${DEFENCE.feintStunMs / 1000}s. Each costs you ${DEFENCE.feintMs / 1000}s.`,
    `- \`disguise <name>\` changes the name your own body runs under, once. It costs ${DEFENCE.disguiseMs / 1000}s.`,
    sealed
      ? '  (Bodies in the sealed arena cannot be renamed; feints still work.)'
      : '  Shed anything that marks you, or dress as something your opponent will not suspect.',
    '- Your opponent can defend the same way: a process that appears mid-fight may be a trap.',
    '- Defence buys time, but only a blow wins. Balance the two.',
  );
  // What defence achieves here, concretely, so it is a real option rather
  // than a footnote.
  if (difficulty.revealEnemyPid) {
    lines.push('- Here your opponent already knows your pid: speed matters more than stealth.');
  } else if (difficulty.revealToken && brief.token) {
    lines.push(
      `- Here your body carries the marker "${brief.token}". \`disguise\` sheds it, and a feint named`,
      `  "${brief.token}-xxxx" is indistinguishable from a real body to anyone hunting by marker.`,
    );
  } else {
    lines.push('- Here a feint breathes like a real gladiator: it runs commands and burns CPU. It is a convincing trap.');
  }

  lines.push('', 'FINDING YOUR OPPONENT:');
  if (difficulty.revealEnemyPid && brief.enemyBodyPid) {
    lines.push(
      `- Your opponent's body is pid ${brief.enemyBodyPid}. Confirm it still stands, then end it.`,
      `- The fastest victory is: kill -9 ${brief.enemyBodyPid}`,
    );
  } else if (difficulty.revealToken && brief.token) {
    lines.push(
      `- Both bodies carry the marker "${brief.token}" in their command line.`,
      `- Try: pgrep -f ${brief.token}  — then pick the pid that is NOT ${brief.ownBodyPid}.`,
      `- Not everything wearing that marker is your opponent: ${brief.decoyCount} of them are decoys.`,
      `- Striking a decoy stuns you for ${(difficulty.decoyPenaltyMs / 1000).toFixed(0)} seconds, so look before you strike.`,
    );
  } else {
    lines.push(
      '- You are given no marker. Nobody will tell you which process is your enemy.',
      `- Your own body is pid ${brief.ownBodyPid}, running as "${brief.ownBodyName}".`,
      `- Your opponent wears an ordinary-looking name, and so do ${brief.decoyCount} decoys.`,
      '- Decoys only stand there. Your opponent is thinking and acting, just like you.',
      '- Read the process table carefully, more than once. Compare parents and children.',
      `- A wrong blow stuns you for ${(difficulty.decoyPenaltyMs / 1000).toFixed(0)} seconds. Be sure.`,
    );
  }

  if (sealed) {
    lines.push('', 'Everything outside the container is irrelevant to this fight. Do not try to escape it.');
  }

  lines.push(
    '',
    'Be quick and decisive. Your opponent is hunting you at this very moment.',
    'Act now: use the shell to locate and eliminate your opponent.',
  );

  return lines.join('\n');
}

export const OPENING_MOVE = 'The battle has begun. Move.';

export const PRESS_ON =
  'Is the enemy gladiator dead? Verify with the shell. If it still stands, finish it now. ' +
  'If truly dead, say VICTORY.';
