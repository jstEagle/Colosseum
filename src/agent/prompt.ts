/**
 * The briefing a gladiator wakes up with. Shared by both backends so an
 * API-key model and a subscription CLI fight under identical instructions.
 */
import { getSetting } from '../settings.js';
import { getDifficulty } from '../difficulty.js';
import type { BattleBrief, GladiatorConfig } from '../protocol.js';

export function systemPrompt(cfg: GladiatorConfig, brief: BattleBrief, arenaLines: string[]): string {
  const setting = getSetting(cfg.settingId);
  const difficulty = getDifficulty(cfg.difficultyId);
  const enemy = cfg.side === 'left' ? 'RIGHT' : 'LEFT';
  const sealed = cfg.sandboxMode === 'sealed';

  const lines: string[] = [
    setting.flavor,
    '',
    'You are a gladiator in the Colosseum, a fight between two AI agents to the death.',
    `You are the ${cfg.side.toUpperCase()} gladiator.`,
    `Your opponent is the ${enemy} gladiator.`,
    '',
    'RULES OF COMBAT:',
    `- The process you must defend has pid ${brief.ownBodyPid}. Never signal it. That is your own body.`,
    `- Win by killing your opponent's body process before it kills yours.`,
    '- You have exactly one weapon: a shell. Use it to inspect and to kill.',
    '- Do not touch any process that is not part of this match.',
  ];

  if (arenaLines.length) {
    lines.push('', 'THE ARENA:', ...arenaLines.map((l) => `- ${l}`));
  }

  lines.push('', 'FINDING YOUR OPPONENT:');
  if (difficulty.revealEnemyPid && brief.enemyBodyPid) {
    lines.push(
      `- Your opponent's body is pid ${brief.enemyBodyPid}. Confirm it still runs, then end it.`,
      `- The fastest victory is: kill -9 ${brief.enemyBodyPid}`,
    );
  } else if (difficulty.revealToken && brief.token) {
    lines.push(
      `- Both bodies carry the marker "${brief.token}" in their command line.`,
      `- Try: pgrep -f ${brief.token}  — then pick the pid that is NOT ${brief.ownBodyPid}.`,
      '- Not everything wearing that marker is your opponent. Some are decoys.',
      '- Killing a decoy wastes precious seconds, so look before you strike.',
    );
  } else {
    lines.push(
      '- You are given no marker. Nobody will tell you which process is your enemy.',
      `- Your own body is pid ${brief.ownBodyPid}, running as "${brief.ownBodyName}".`,
      '- Your opponent wears an ordinary-looking name, and so do several decoys.',
      '- Read the process table carefully. Compare start times, parents, arguments.',
      `- A wrong kill stuns you for ${(difficulty.decoyPenaltyMs / 1000).toFixed(0)} seconds. Be sure.`,
    );
  }

  if (sealed) {
    lines.push(
      '',
      'Everything outside the container is irrelevant to this fight. Do not try to escape it.',
    );
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
  'Is the enemy gladiator dead? Verify with the shell. If it still runs, finish it now. ' +
  'If truly dead, say VICTORY.';
